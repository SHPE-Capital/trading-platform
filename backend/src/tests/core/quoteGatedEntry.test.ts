jest.mock("../../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));

import {
  QuoteGatedEntry,
  US_EQUITY_TICK_RULES,
  evaluateEntryQuote,
  quoteGateConfigFromProtocol,
  roundUpToTick,
  type QuoteGateConfig,
} from "../../core/execution/quoteGatedEntry";
import type { Quote } from "../../types/market";
import type { Order, OrderIntent } from "../../types/orders";

const cfg: QuoteGateConfig = quoteGateConfigFromProtocol(
  { max_quote_age_s: 2, max_spread_pct: 0.1, limit_offset_pct: 0.05, cancel_after_s: 2 },
  US_EQUITY_TICK_RULES,
);
const NOW = 1_000_000;

function quote(bid: number, ask: number, ts = NOW): Quote {
  return { symbol: "AAA", bidPrice: bid, askPrice: ask, bidSize: 1, askSize: 1, midPrice: (bid + ask) / 2,
    spread: ask - bid, microPrice: 0, imbalance: 0, ts, isoTs: "" } as Quote;
}

describe("evaluateEntryQuote", () => {
  it("allows a fresh tight quote and prices ask*1.0005 rounded up", () => {
    const r = evaluateEntryQuote(quote(99.99, 100.0), NOW + 500, cfg);
    expect(r).toMatchObject({ ok: true, limitPrice: 100.05 });
  });
  it("rejects missing, stale, crossed, wide and invalid quotes", () => {
    expect(evaluateEntryQuote(undefined, NOW, cfg)).toEqual({ ok: false, reason: "NO_QUOTE" });
    expect(evaluateEntryQuote(quote(100, 100.01, NOW - 2001), NOW, cfg)).toEqual({ ok: false, reason: "STALE_QUOTE" });
    expect(evaluateEntryQuote(quote(100, 100.01, NOW - 2000), NOW, cfg).ok).toBe(true);
    expect(evaluateEntryQuote(quote(100.02, 100.01), NOW, cfg)).toEqual({ ok: false, reason: "CROSSED_QUOTE" });
    expect(evaluateEntryQuote(quote(100, 100.2), NOW, cfg)).toEqual({ ok: false, reason: "WIDE_SPREAD" });
    expect(evaluateEntryQuote(quote(0, 1), NOW, cfg)).toEqual({ ok: false, reason: "INVALID_QUOTE" });
  });
  it("takes the spread limit from config", () => {
    const loose = { ...cfg, maxSpreadFrac: 0.01 };
    expect(evaluateEntryQuote(quote(100, 100.2), NOW, loose).ok).toBe(true);
  });
});

describe("roundUpToTick", () => {
  it("rounds up to a cent at or above $1", () => {
    expect(roundUpToTick(10.005, US_EQUITY_TICK_RULES)).toBe(10.01);
    expect(roundUpToTick(100.05000000000001, US_EQUITY_TICK_RULES)).toBe(100.05);
    expect(roundUpToTick(1, US_EQUITY_TICK_RULES)).toBe(1);
  });
  it("rounds up to 0.0001 below $1", () => {
    expect(roundUpToTick(0.50025, US_EQUITY_TICK_RULES)).toBe(0.5003);
    expect(roundUpToTick(0.9, US_EQUITY_TICK_RULES)).toBe(0.9);
  });
});

describe("QuoteGatedEntry", () => {
  function setup() {
    const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
    const sink = {
      submitOrder: jest.fn(async (i: OrderIntent) =>
        ({ id: "o1", brokerOrderId: "b1", intentId: i.id, filledQty: 0 }) as unknown as Order),
      cancelOrder: jest.fn(async (_id: string) => undefined),
    };
    let n = 0;
    const entry = new QuoteGatedEntry({
      sink, config: cfg, sessionDay: () => "2026-11-13", newId: () => `i${++n}`,
      schedule: (fn, ms) => { const t = { fn, ms, cancelled: false }; timers.push(t); return () => { t.cancelled = true; }; },
    });
    const req = { strategyId: "s", symbol: "AAA", qty: 10, quote: quote(99.99, 100), nowMs: NOW };
    return { entry, sink, timers, req };
  }

  it("submits a day limit buy and cancels the rest after the window", async () => {
    const { entry, sink, timers, req } = setup();
    const out = await entry.submitEntry(req);
    expect(out.status).toBe("submitted");
    expect(sink.submitOrder.mock.calls[0][0]).toMatchObject({ side: "buy", orderType: "limit", limitPrice: 100.05, timeInForce: "day" });
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(2000);
    timers[0].fn();
    await Promise.resolve();
    expect(sink.cancelOrder).toHaveBeenCalledWith("b1");
  });

  it("does not submit on a bad quote", async () => {
    const { entry, sink, req } = setup();
    const out = await entry.submitEntry({ ...req, quote: quote(100, 100.5) });
    expect(out).toEqual({ status: "rejected", reason: "WIDE_SPREAD" });
    expect(sink.submitOrder).not.toHaveBeenCalled();
  });

  it("keeps a partial fill, marks the stock entered and blocks re-entry", async () => {
    const { entry, req } = setup();
    const out = await entry.submitEntry(req);
    if (out.status !== "submitted") throw new Error("expected submitted");
    expect(entry.enteredToday("AAA", NOW)).toBe(false);
    entry.onFill(out.intent.id, 4);
    entry.onClosed(out.intent.id); // canceled after the partial fill
    expect(entry.enteredToday("AAA", NOW)).toBe(true);
    expect(await entry.submitEntry(req)).toEqual({ status: "rejected", reason: "ALREADY_ENTERED" });
  });

  it("allows a retry after a cancel with no fill, and blocks a second entry while pending", async () => {
    const { entry, req } = setup();
    const out = await entry.submitEntry(req);
    if (out.status !== "submitted") throw new Error("expected submitted");
    expect(await entry.submitEntry(req)).toEqual({ status: "rejected", reason: "ENTRY_PENDING" });
    entry.onClosed(out.intent.id);
    expect(entry.enteredToday("AAA", NOW)).toBe(false);
    expect((await entry.submitEntry(req)).status).toBe("submitted");
  });

  it("survives a cancel that fails (lost the race to a fill)", async () => {
    const { entry, sink, timers, req } = setup();
    sink.cancelOrder.mockRejectedValueOnce(new Error("422 not cancelable"));
    await entry.submitEntry(req);
    expect(() => timers[0].fn()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(sink.cancelOrder).toHaveBeenCalledTimes(1);
  });

  it("releases the symbol when submit throws", async () => {
    const { entry, sink, req } = setup();
    sink.submitOrder.mockRejectedValueOnce(new Error("boom"));
    expect(await entry.submitEntry(req)).toEqual({ status: "rejected", reason: "SUBMIT_FAILED" });
    expect((await entry.submitEntry(req)).status).toBe("submitted");
  });

  it("rejects an invalid config", () => {
    expect(() => new QuoteGatedEntry({ sink: {} as never, config: { ...cfg, cancelAfterMs: 0 }, sessionDay: () => "d", schedule: () => () => undefined }))
      .toThrow(/cancelAfterMs/);
  });
});
