/**
 * tests/core/latencyProbe.test.ts
 *
 * Guide §19 scenarios for the instrumentation itself:
 *   - disabled instrumentation preserves behaviour (identical published events
 *     and decisions)
 *   - batched events share one receipt time but keep their own spans
 *   - nested synchronous and asynchronous order work stays correlated by id
 *   - sampled telemetry declares its denominator; histograms see every event
 *   - durable-journal failure still prevents broker submission when timed
 *   - an ambiguous submit error is not retried
 *   - late order updates and updates before the submit response are handled
 */

import { EventBus } from "../../core/engine/eventBus";
import { AlpacaMarketDataAdapter } from "../../adapters/alpaca/marketData";
import { LatencyProbe } from "../../core/telemetry/latencyProbe";
import { JournaledExecutionSink, JournalUnavailableError } from "../../core/execution/journaledExecution";
import { TimedExecutionSink, TimedOrderJournal } from "../../core/telemetry/orderPathTiming";
import { buildBenchEngine } from "../../bench/engine";
import { runProcessingReplay } from "../../bench/processingReplay";
import { generateSyntheticFrames } from "../../bench/syntheticWorkload";
import { seededRandom } from "../../bench/random";
import type { TradingEvent } from "../../types/events";
import type { IExecutionSink } from "../../core/execution/IExecutionSink";
import type { OrderJournal } from "../../core/execution/journaledExecution";
import type { OrderIntent } from "../../types/orders";

const T = "2026-03-10T14:30:00.100000000Z";
const frame = (msgs: unknown[]): string => JSON.stringify(msgs);
const q = (S: string, bp: number, ap: number, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ T: "q", S, bp, ap, bs: 2, as: 1, bx: "V", ax: "V", z: "B", c: ["R"], t: T, ...extra });

function publishedEvents(adapter: AlpacaMarketDataAdapter, bus: EventBus, frames: string[]): TradingEvent[] {
  const out: TradingEvent[] = [];
  bus.onAll((e) => { out.push(e); });
  frames.forEach((f) => adapter.ingestFrame(f));
  return out;
}

const strip = (e: TradingEvent): Record<string, unknown> => {
  const { id: _id, ts: _ts, trace: _trace, ...rest } = e as unknown as Record<string, unknown>;
  return rest;
};

describe("instrumentation is behaviour-neutral", () => {
  const frames = [
    frame([q("SPY", 500, 500.02), { T: "t", S: "SPY", p: 500.01, s: 5, i: 1, t: T }, q("SPY", 500, 0)]),
    frame([{ T: "b", S: "SPY", o: 500, h: 501, l: 499, c: 500.5, v: 10, t: "2026-03-10T14:30:00Z" }, { T: "zz" }]),
  ];

  it("publishes the same events, in the same order, with and without a probe", () => {
    const busA = new EventBus();
    const plain = publishedEvents(new AlpacaMarketDataAdapter(busA, "replay"), busA, frames);
    const busB = new EventBus();
    const probe = new LatencyProbe({ runId: "t", sampleProbability: 1, detail: "stage" });
    const observed = publishedEvents(new AlpacaMarketDataAdapter(busB, "replay", { probe }), busB, frames);
    expect(observed.map(strip)).toEqual(plain.map(strip));
    expect(plain.every((e) => e.trace === undefined)).toBe(true);
    expect(observed.every((e) => typeof e.trace?.id === "string")).toBe(true);
  });

  it("frame detail publishes the same events too, with one shared trace per frame", () => {
    const busA = new EventBus();
    const plain = publishedEvents(new AlpacaMarketDataAdapter(busA, "replay"), busA, frames);
    const busB = new EventBus();
    const probe = new LatencyProbe({ runId: "t", sampleProbability: 0 });
    const observed = publishedEvents(new AlpacaMarketDataAdapter(busB, "replay", { probe }), busB, frames);
    expect(observed.map(strip)).toEqual(plain.map(strip));
    const firstFrame = observed.slice(0, 3).map((e) => e.trace);
    expect(new Set(firstFrame.map((t) => t?.id)).size).toBe(1);
    expect(firstFrame[0]).toBe(firstFrame[1]); // literally the same object
  });

  it("an engine makes identical decisions with and without instrumentation", async () => {
    const workload = [...generateSyntheticFrames({ symbols: ["SPY", "QQQ"], durationMs: 20_000, quotesPerSecPerSymbol: 40, tradesPerSecPerSymbol: 5, seed: 9 })];
    const run = async (probe?: LatencyProbe): Promise<unknown> => {
      const engine = buildBenchEngine({ strategy: { name: "quote_imbalance", count: 2, symbols: ["SPY", "QQQ"] }, sink: "sim", probe });
      try {
        return (await runProcessingReplay(workload, { engine, probe, pacing: { mode: "max" } })).decisions;
      } finally {
        engine.stop();
      }
    };
    const off = await run();
    const frameDetail = await run(new LatencyProbe({ runId: "a", sampleProbability: 0.5 }));
    const stageDetail = await run(new LatencyProbe({ runId: "b", sampleProbability: 1, detail: "stage" }));
    expect((off as Record<string, unknown>)["signals"]).toBeGreaterThan(0);
    expect(frameDetail).toEqual(off);
    expect(stageDetail).toEqual(off);
  });
});

describe("receipt time and spans", () => {
  it("events in one batch share the frame's receipt time but keep individual spans", () => {
    const bus = new EventBus();
    const probe = new LatencyProbe({ runId: "t", sampleProbability: 1, detail: "stage" });
    const adapter = new AlpacaMarketDataAdapter(bus, "replay", { probe });
    adapter.ingestFrame(frame([q("SPY", 500, 500.02), q("SPY", 500.01, 500.03), q("QQQ", 430, 430.02)]), 1, 7, Date.UTC(2026, 2, 10, 14, 30, 0, 102));
    const traces = probe.traceSamples().filter((t) => t.record === "market_event");
    expect(traces).toHaveLength(3);
    expect(new Set(traces.map((t) => t["receive_monotonic_ns"])).size).toBe(1);
    expect(traces.map((t) => t["trace_id"])).toEqual(["1:7:0", "1:7:1", "1:7:2"]);
    const normStarts = traces.map((t) => (t["stages"] as Array<{ stage: string; start_ns: string }>).find((s) => s.stage === "normalize")!.start_ns);
    expect(new Set(normStarts).size).toBe(3);
    // Later events in the batch waited longer: queueing inside the frame is visible.
    const queue = probe.histogram("event.queue_in_frame_ns.quote")!;
    expect(queue.count).toBe(3);
    // Event age is computed from the recorded receipt (2 ms after the provider time).
    expect(probe.histogram("event.age_ns.quote")!.max).toBe(2_000_000);
  });

  it("keeps negative event ages in their own distribution", () => {
    const bus = new EventBus();
    const probe = new LatencyProbe({ runId: "t", sampleProbability: 0 });
    const adapter = new AlpacaMarketDataAdapter(bus, "replay", { probe });
    adapter.ingestFrame(frame([q("SPY", 500, 500.02)]), 1, 1, Date.UTC(2026, 2, 10, 14, 30, 0, 95)); // 5 ms before provider time
    expect(probe.histogram("event.age_ns.quote")).toBeUndefined();
    expect(probe.histogram("event.age_ns.quote.negative")!.max).toBe(5_000_000);
    expect(probe.counter("event.age_ns.quote.negative_count")).toBe(1);
  });

  it("counts unknown, invalid and unparseable input without crashing the stream", () => {
    const bus = new EventBus();
    const probe = new LatencyProbe({ runId: "t", sampleProbability: 0 });
    const adapter = new AlpacaMarketDataAdapter(bus, "replay", { probe, invalidData: "quarantine" });
    const published: TradingEvent[] = [];
    bus.onAll((e) => { published.push(e); });
    expect(() => {
      adapter.ingestFrame("garbage");
      adapter.ingestFrame(JSON.stringify({ T: "q" }));
      adapter.ingestFrame(frame([null, 7, { T: "x" }, q("SPY", 500.05, 500), q("SPY", 500, 500.02)]));
    }).not.toThrow();
    expect(probe.counter("frames.parse_failed")).toBe(2);
    expect(probe.counter("issues.quote.CROSSED_QUOTE")).toBe(1);
    expect(probe.counter("quarantined.quote")).toBe(1);
    expect(probe.counter("revisions.trade_canceled_rejected")).toBe(1); // a cancel without its trade id
    expect(published).toHaveLength(1); // only the valid quote reaches the bus
  });
});

describe("sampling denominators and bounds", () => {
  it("histograms count every event while traces are sampled and declared", () => {
    const bus = new EventBus();
    const probe = new LatencyProbe({ runId: "t", sampleProbability: 0.25, detail: "stage", random: seededRandom(1), maxTraceSamples: 50 });
    const adapter = new AlpacaMarketDataAdapter(bus, "replay", { probe });
    for (let i = 0; i < 400; i++) adapter.ingestFrame(frame([q("SPY", 500, 500.02)]));
    const snap = probe.snapshot();
    expect(snap.histograms["event.normalize_ns.quote"].count).toBe(400);
    expect(snap.sampling.traces_total).toBe(400);
    expect(snap.sampling.traces_sampled).toBeGreaterThan(60);
    expect(snap.sampling.traces_sampled).toBeLessThan(140);
    expect(snap.sampling.traces_retained).toBe(50); // reservoir bound
    expect(probe.traceSamples()).toHaveLength(50);
  });

  it("evicts (and counts) traces that never finish instead of growing", () => {
    const probe = new LatencyProbe({ runId: "t", sampleProbability: 0, detail: "stage", maxOpenTraces: 10 });
    const f = { epoch: 1, seq: 1, rxWallMs: 0, rxMonoNs: 0n, text: "" };
    for (let i = 0; i < 25; i++) {
      probe.marketEvent({ frame: f, index: i, kind: "quote", symbol: "S", providerTs: T, normStartNs: 1n, normEndNs: 2n, issue: null, quarantined: false });
    }
    expect(probe.snapshot().sampling.open_trace_evictions).toBe(15);
  });

  it("counts deadline misses for metrics that have a deadline", () => {
    const probe = new LatencyProbe({ runId: "t", deadlinesMs: { "order.journal_ns": 1 } });
    probe.journal("i1", 0n, 500_000n, "ok");
    probe.journal("i2", 0n, 3_000_000n, "ok");
    expect(probe.counter("deadline_miss.order.journal_ns")).toBe(1);
    expect(probe.snapshot().counters["deadline_miss.order.journal_ns"]).toBe(1);
  });
});

describe("order-path correlation", () => {
  const intent = (id: string): OrderIntent =>
    ({ id, strategyId: "s", symbol: "SPY", side: "buy", qty: 1, orderType: "market", timeInForce: "ioc", ts: 1 }) as OrderIntent;

  it("keeps concurrent intents correlated through asynchronous journal waits", async () => {
    let clock = 0n;
    const probe = new LatencyProbe({ runId: "t", sampleProbability: 1, clock: () => clock });
    probe.intentReady("slow", { id: "1:1", rxMonoNs: 100 }, 150n);
    probe.intentReady("fast", { id: "1:2", rxMonoNs: 200 }, 250n);
    const journal: OrderJournal = {
      recordPending: (i) => new Promise((r) => setTimeout(r, i.id === "slow" ? 30 : 1)),
      recordSendFailed: async () => {},
    };
    const inner: IExecutionSink = { submitOrder: async (i) => ({ id: i.id }) as never, cancelOrder: async () => {} };
    const sink = new JournaledExecutionSink(new TimedExecutionSink(inner, probe), new TimedOrderJournal(journal, probe));
    clock = 1_000n;
    const both = Promise.all([sink.submitOrder(intent("slow")), sink.submitOrder(intent("fast"))]);
    await both;
    // receive→submit uses each intent's own receipt time, not a shared "current" one.
    const r2s = probe.histogram("order.receive_to_submit_ns")!;
    expect(r2s.count).toBe(2);
    expect(r2s.min).toBe(800); // 1000 − 200
    expect(r2s.max).toBe(900); // 1000 − 100
  });

  it("a journal failure is timed, re-thrown, and the broker is never called", async () => {
    const probe = new LatencyProbe({ runId: "t" });
    probe.intentReady("i1", { id: "1:1", rxMonoNs: 0 }, 1n);
    const inner: IExecutionSink = { submitOrder: jest.fn(), cancelOrder: jest.fn() };
    const journal: OrderJournal = { recordPending: async () => { throw new Error("db down"); }, recordSendFailed: async () => {} };
    const sink = new JournaledExecutionSink(new TimedExecutionSink(inner, probe), new TimedOrderJournal(journal, probe));
    await expect(sink.submitOrder(intent("i1"))).rejects.toBeInstanceOf(JournalUnavailableError);
    expect(inner.submitOrder).not.toHaveBeenCalled();
    expect(probe.counter("journal.outcome.failed_Error")).toBe(1);
    expect(probe.counter("intents.finished.journal_failed_Error")).toBe(1);
  });

  it("an ambiguous submit failure is recorded once and not retried", async () => {
    const probe = new LatencyProbe({ runId: "t" });
    probe.intentReady("i1", { id: "1:1", rxMonoNs: 0 }, 1n);
    const timeout = Object.assign(new Error("request timed out"), { name: "TimeoutError" });
    const inner: IExecutionSink = { submitOrder: jest.fn(async () => { throw timeout; }), cancelOrder: jest.fn() };
    const journal: OrderJournal = { recordPending: async () => {}, recordSendFailed: jest.fn(async () => {}) };
    const sink = new JournaledExecutionSink(new TimedExecutionSink(inner, probe), new TimedOrderJournal(journal, probe));
    await expect(sink.submitOrder(intent("i1"))).rejects.toBe(timeout);
    expect(inner.submitOrder).toHaveBeenCalledTimes(1);
    expect(journal.recordSendFailed).toHaveBeenCalledTimes(1);
    expect(probe.counter("submit.outcome.error_TimeoutError")).toBe(1);
  });

  it("handles an update before the submit response and ignores updates after the order finished", () => {
    const probe = new LatencyProbe({ runId: "t", clock: () => 0n });
    probe.intentReady("i1", { id: "1:1", rxMonoNs: 0 }, 1n);
    probe.submitStart("i1", 10n);
    probe.orderUpdate("i1", "partial_fill", 15n); // stream beat the REST response
    probe.fillApplied("i1", 16n, false);
    probe.submitEnd("i1", 20n, "ok");
    probe.orderUpdate("i1", "filled", 30n);
    probe.fillApplied("i1", 31n, true);
    probe.orderUpdate("i1", "canceled", 40n); // late, after the order finished
    expect(probe.histogram("order.submit_to_first_update_ns")!.toJSON().max).toBe(5);
    expect(probe.histogram("order.submit_to_response_ns")!.max).toBe(10);
    expect(probe.histogram("order.receive_to_fill_applied_ns")!.count).toBe(2);
    expect(probe.counter("intents.finished.filled")).toBe(1);
    expect(probe.counter("intents.finished.canceled")).toBe(0);
  });
});
