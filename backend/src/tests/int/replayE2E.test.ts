/**
 * Record → persist → list → load (filtered) → play → attribution, through the
 * real EventRecorder, ReplayEngine, AttributionCollector and HTTP API. Only
 * the event_logs table is replaced, by an in-memory store.
 */

import request from "supertest";
import { createApp } from "../../app/index";
import { EventBus } from "../../core/engine/eventBus";
import { EventRecorder, eventLogFor } from "../../core/replay/eventRecorder";
import { ReplayEngine } from "../../core/replay/replayEngine";
import { AttributionCollector } from "../../core/replay/attributionCollector";
import type { TradingEvent } from "../../types/events";
import type { EventLogRecord } from "../../types/replay";

jest.mock("../../adapters/supabase/eventLogRepository", () => {
  const store = new Map<string, { record: EventLogRecord; events: TradingEvent[] }>();
  return {
    insertEventLog: jest.fn(async (record: Omit<EventLogRecord, "createdAt">, events: TradingEvent[]) => {
      // Round-trip through JSON as the jsonb column would.
      store.set(record.id, { record: { ...record, createdAt: Date.now() }, events: JSON.parse(JSON.stringify(events)) });
    }),
    listEventLogs: jest.fn(async () => [...store.values()].map((l) => l.record)),
    getEventLog: jest.fn(async (id: string) => store.get(id) ?? null),
  };
});

import { insertEventLog } from "../../adapters/supabase/eventLogRepository";

const LOG_ID = "0b6c7a52-3d1e-4f8a-9c2b-5e4d3c2b1a09";
const T0 = 1_761_660_000_000;

/** A recorded paper session: SPY long round trip, a QQQ quote, a rejected signal. */
function tradingSession(): TradingEvent[] {
  const e = (type: string, dt: number, rest: Record<string, unknown>) =>
    ({ id: `${type}-${dt}`, type, ts: T0 + dt, mode: "paper", ...rest }) as unknown as TradingEvent;
  return [
    e("QUOTE_RECEIVED", 0, { payload: { symbol: "SPY", bidPrice: 499.95, askPrice: 500.05 } }),
    e("QUOTE_RECEIVED", 10, { payload: { symbol: "QQQ", bidPrice: 399.95, askPrice: 400.05 } }),
    e("STRATEGY_SIGNAL_CREATED", 20, { strategyId: "pairs-1", signalId: "sig-1", payload: { id: "p1", symbol: "SPY", direction: "long" } }),
    e("ORDER_SUBMITTED", 30, { payload: { id: "ord-1", signalId: "sig-1", strategyId: "pairs-1", symbol: "SPY" } }),
    e("ORDER_FILLED", 40, { orderId: "ord-1", fill: { orderId: "ord-1", symbol: "SPY", side: "buy", qty: 10, price: 500.05, ts: T0 + 40 } }),
    e("PORTFOLIO_UPDATED", 50, { payload: { equity: 100_000 } }),
    e("QUOTE_RECEIVED", 60, { payload: { symbol: "SPY", bidPrice: 501.95, askPrice: 502.05 } }),
    e("STRATEGY_SIGNAL_CREATED", 70, { strategyId: "pairs-1", signalId: "sig-2", payload: { id: "p2", symbol: "SPY", direction: "close_long" } }),
    e("ORDER_SUBMITTED", 80, { payload: { id: "ord-2", signalId: "sig-2", strategyId: "pairs-1", symbol: "SPY" } }),
    e("ORDER_FILLED", 90, { orderId: "ord-2", fill: { orderId: "ord-2", symbol: "SPY", side: "sell", qty: 10, price: 502, ts: T0 + 90 } }),
    e("PORTFOLIO_UPDATED", 100, { payload: { equity: 100_019.5 } }),
    e("STRATEGY_SIGNAL_CREATED", 110, { strategyId: "pairs-1", signalId: "sig-3", payload: { id: "p3", symbol: "SPY", direction: "long" } }),
    e("RISK_REJECTED", 120, { strategyId: "pairs-1", reason: "cooldown", rejectedIntent: { symbol: "SPY", signalId: "sig-3" } }),
  ];
}

async function waitForStatus(app: Express.Application, status: string, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(app).get("/api/replay/status");
    if (res.body?.status === status || Date.now() > deadline) return res.body;
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("replay end to end", () => {
  // 1. A trading runtime records its bus and saves the recording on shutdown.
  beforeAll(async () => {
    const liveBus = new EventBus();
    const recorder = new EventRecorder(liveBus, 1_000);
    recorder.start();
    tradingSession().forEach((event) => liveBus.publish(event));
    const recording = recorder.stop();
    await insertEventLog(eventLogFor(LOG_ID, "paper", recording), recording.events);
  });

  // 2. The replay runtime serves it.
  const replayBus = new EventBus();
  const replayEngine = new ReplayEngine(replayBus);
  const attributionCollector = new AttributionCollector(replayBus);
  const app = createApp({ replayEngine, attributionCollector });
  const ticks: TradingEvent[] = [];
  replayBus.on("REPLAY_TICK", (t) => { ticks.push(t); });

  afterAll(() => {
    replayEngine.stop();
    attributionCollector.stop();
  });

  it("lists the recorded session", async () => {
    const res = await request(app).get("/api/replay/sessions");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([expect.objectContaining({
      id: LOG_ID, source: "paper", eventCount: 13,
      startDate: new Date(T0).toISOString(), endDate: new Date(T0 + 120).toISOString(),
    })]);
  });

  it("rejects an unknown session", async () => {
    const res = await request(app).post("/api/replay/load").send({ sessionId: "11111111-2222-4333-8444-555555555555" });
    expect(res.status).toBe(404);
  });

  it("loads with a filter, plays to completion, and reports attribution", async () => {
    const load = await request(app).post("/api/replay/load").send({ sessionId: LOG_ID, filter: { symbols: ["SPY"] } });
    expect(load.status).toBe(200);
    // The QQQ quote is filtered out; portfolio events have no symbol and stay.
    expect(load.body.session).toMatchObject({ totalEvents: 12, cursor: 0, status: "paused", simulatedNow: T0 });
    expect(load.body.session).not.toHaveProperty("events");

    await request(app).post("/api/replay/control").send({ action: "set_speed", speed: 10 }).expect(200);
    expect((await request(app).get("/api/replay/attribution")).status).toBe(409);

    await request(app).post("/api/replay/control").send({ action: "play" }).expect(200);
    const done = await waitForStatus(app, "completed");
    expect(done).toMatchObject({ status: "completed", cursor: 12, simulatedNow: T0 + 120 });
    expect(ticks.at(-1)).toMatchObject({ status: "completed", cursor: 12, sessionId: done.id });

    const attribution = await request(app).get("/api/replay/attribution");
    expect(attribution.status).toBe(200);
    expect(attribution.body).toMatchObject({
      sessionId: done.id, totalSignals: 3, filledSignals: 2, winRate: 1, avgHoldingTimeMs: 50,
    });
    expect(attribution.body.totalRealizedPnl).toBeCloseTo(19.5);
    expect(attribution.body.signals[0].slippageBps).toBeCloseTo(1);
    expect(attribution.body.signals[2].outcome).toBe("risk_rejected");
    expect(attribution.body.equityCurve).toHaveLength(2);
  });

  it("seeks by timestamp after completion", async () => {
    const res = await request(app).post("/api/replay/control").send({ action: "seek_ts", targetTs: T0 + 65 });
    expect(res.body.session).toMatchObject({ cursor: 6, status: "paused" });
  });
});
