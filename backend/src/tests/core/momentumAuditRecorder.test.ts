jest.mock("../../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));

import { EventBus } from "../../core/engine/eventBus";
import {
  MomentumAuditRecorder,
  type AuditBarRow,
  type AuditEventRow,
  type BarCorrectionRow,
} from "../../core/live/momentumAuditRecorder";
import type { TradingEvent } from "../../types/events";

const T0 = Date.UTC(2026, 10, 13, 15, 0, 0);

function bar(close: number, ts = T0) {
  return { symbol: "AAA", open: 1, high: 2, low: 0.5, close, volume: 100, vwap: 1.1, tradeCount: 7, ts, isoTs: "", timeframe: "1m" };
}

function setup(opts: { failEvents?: boolean; maxBuffered?: number } = {}) {
  const bars: AuditBarRow[] = [];
  const events: AuditEventRow[] = [];
  const corrections: BarCorrectionRow[] = [];
  let fail = opts.failEvents ?? false;
  const recorder = new MomentumAuditRecorder(
    {
      runId: "run-1",
      insertBars: async (r) => { bars.push(...r); },
      insertEvents: async (r) => { if (fail) throw new Error("db down"); events.push(...r); },
      insertCorrections: async (r) => { corrections.push(...r); },
    },
    { flushMs: 1000, maxBuffered: opts.maxBuffered ?? 100, maxTracked: 100 },
  );
  const bus = new EventBus();
  recorder.attach(bus);
  const pub = (e: Record<string, unknown>) => bus.publish({ id: "e", mode: "paper", ts: T0 + 1000, ...e } as unknown as TradingEvent);
  return { recorder, pub, bars, events, corrections, setFail: (v: boolean) => { fail = v; } };
}

describe("MomentumAuditRecorder", () => {
  it("links bar, signal, intent, order, fill and account state in one chain", async () => {
    const { recorder, pub, events, bars } = setup();
    pub({ type: "BAR_RECEIVED", payload: bar(1.5) });
    pub({ type: "STRATEGY_SIGNAL_CREATED", strategyId: "s", signalId: "sig-1", ts: T0 + 1100,
      payload: { id: "sig-1", symbol: "AAA", qty: 10, strategyId: "s" } });
    pub({ type: "ORDER_INTENT_CREATED", ts: T0 + 1200, strategyId: "s",
      payload: { id: "int-1", signalId: "sig-1", symbol: "AAA", qty: 10, limitPrice: 1.6 } });
    pub({ type: "ORDER_SUBMITTED", ts: T0 + 1300,
      payload: { id: "ord-1", intentId: "int-1", signalId: "sig-1", symbol: "AAA", qty: 10, limitPrice: 1.6, brokerOrderId: "b-1" } });
    pub({ type: "ORDER_ACKNOWLEDGED", ts: T0 + 1400, orderId: "ord-1", brokerOrderId: "b-1" });
    pub({ type: "ORDER_FILLED", ts: T0 + 1500, orderId: "ord-1", fill: { symbol: "AAA", qty: 10, price: 1.55 } });
    pub({ type: "PORTFOLIO_UPDATED", ts: T0 + 1600, payload: { equity: 99, cash: 80, positionsValue: 19, totalRealizedPnl: 0, totalUnrealizedPnl: -1, positions: [] } });
    await recorder.flush();

    expect(bars).toHaveLength(1);
    expect(events.map((e) => e.stage)).toEqual(["signal", "order_request", "submitted", "ack", "fill", "account_state"]);
    for (const e of events) {
      expect(e.bar_ts).toBe(new Date(T0).toISOString());
      expect(e.bar_first_seen_at).toBe(new Date(T0 + 1000).toISOString());
      expect(e.signal_id).toBe("sig-1");
    }
    expect(events[5]).toMatchObject({ order_id: "ord-1", broker_order_id: "b-1", intent_id: "int-1" });
    expect(events[5].detail).toMatchObject({ equity: 99 });
  });

  it("records a risk rejection and a partial fill then cancel", async () => {
    const { recorder, pub, events } = setup();
    pub({ type: "RISK_REJECTED", strategyId: "s", reason: "too big", failedCheck: "STRATEGY_BUDGET",
      rejectedIntent: { id: "int-9", symbol: "AAA", qty: 5 } });
    pub({ type: "ORDER_SUBMITTED", payload: { id: "ord-2", intentId: "int-2", symbol: "AAA", qty: 10 } });
    pub({ type: "ORDER_PARTIAL_FILL", orderId: "ord-2", remainingQty: 6, fill: { symbol: "AAA", qty: 4, price: 2 } });
    pub({ type: "ORDER_CANCELED", orderId: "ord-2", reason: "timeout" });
    await recorder.flush();
    expect(events.map((e) => e.stage)).toEqual(["risk_rejected", "submitted", "partial_fill", "cancel"]);
    expect(events[0].detail).toMatchObject({ failedCheck: "STRATEGY_BUDGET" });
    expect(events[2]).toMatchObject({ qty: 4, price: 2, intent_id: "int-2" });
  });

  it("keeps first-seen bars and puts corrections in a separate table", async () => {
    const { recorder, pub, bars, corrections } = setup();
    pub({ type: "BAR_RECEIVED", payload: bar(1.5) });
    pub({ type: "BAR_RECEIVED", payload: bar(9.9) }); // repeat of the same bar: first sighting stands
    pub({ type: "BAR_REVISED", ts: T0 + 90_000, payload: bar(1.7) });
    await recorder.flush();
    expect(bars).toHaveLength(1);
    expect(bars[0].close).toBe(1.5);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({ close: 1.7, received_at: new Date(T0 + 90_000).toISOString() });
  });

  it("retries a failed write and drops the oldest rows past the cap", async () => {
    const { recorder, pub, events, setFail } = setup({ failEvents: true, maxBuffered: 2 });
    for (const id of ["a", "b", "c"]) pub({ type: "ORDER_REJECTED", orderId: id, reason: "x" });
    await recorder.flush();
    expect(events).toHaveLength(0);
    setFail(false);
    await recorder.flush();
    expect(events.map((e) => e.order_id)).toEqual(["b", "c"]);
  });

  it("does not let one handler failure reach the bus caller", async () => {
    const { recorder, pub } = setup();
    expect(() => pub({ type: "BAR_RECEIVED", payload: undefined })).not.toThrow();
    await recorder.flush();
  });
});
