/**
 * tests/core/orchestrator.test.ts
 *
 * Unit tests for the Orchestrator's event emission behaviour introduced
 * alongside the expanded WebSocket broadcast set:
 *
 *   - STRATEGY_STARTED emitted per strategy on start()
 *   - STRATEGY_ERROR (phase: "start") when strategy.start() throws
 *   - ENGINE_STARTED emitted when start() is called
 *   - STRATEGY_STOPPED emitted per strategy on stop()
 *   - ENGINE_STOPPED emitted when stop() is called
 *   - STRATEGY_ERROR (phase: "evaluate") when strategy.evaluate() throws
 *   - PORTFOLIO_UPDATED emitted after ORDER_FILLED is processed
 */

import { EventBus } from "../../core/engine/eventBus";
import { Orchestrator } from "../../core/engine/orchestrator";
import { SymbolStateManager } from "../../core/state/symbolState";
import { PortfolioStateManager } from "../../core/state/portfolioState";
import { OrderStateManager } from "../../core/state/orderState";
import { RiskEngine } from "../../core/risk/riskEngine";
import { ExecutionEngine } from "../../core/execution/executionEngine";
import type { IStrategy } from "../../strategies/base/strategy";
import type { TradingEvent } from "../../types/events";
import type { UUID } from "../../types/common";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Attach an onAll handler and return the accumulated event array. */
function captureEvents(bus: EventBus): TradingEvent[] {
  const events: TradingEvent[] = [];
  bus.onAll((e) => { events.push(e); });
  return events;
}

/** Minimal IStrategy stub — all lifecycle methods are jest.fn(). */
function makeStrategy(
  id: string,
  overrides: Partial<IStrategy> = {},
): IStrategy {
  return {
    id: id as UUID,
    type: "pairs_trading",
    config: {
      id: id as UUID,
      name: `Strategy ${id}`,
      type: "pairs_trading",
      symbols: ["SPY", "QQQ"],
      rollingWindowMs: 3_600_000,
      maxPositionSizeUsd: 10_000,
      cooldownMs: 60_000,
      enabled: true,
    },
    start: jest.fn(),
    stop: jest.fn(),
    evaluate: jest.fn().mockReturnValue(null),
    ...overrides,
  };
}

/** Construct a fresh Orchestrator with real state managers and a mock execution sink. */
function makeOrchestrator(bus: EventBus): Orchestrator {
  return new Orchestrator(
    bus,
    new SymbolStateManager(),
    new PortfolioStateManager(100_000),
    new OrderStateManager(),
    new RiskEngine(),
    { submit: jest.fn() } as unknown as ExecutionEngine,
    "paper",
  );
}

/** Minimal valid Fill object for ORDER_FILLED events. */
function makeFill(orderId: string) {
  const ts = Date.now();
  return {
    id: "fill-1" as UUID,
    orderId: orderId as UUID,
    symbol: "SPY",
    side: "buy" as const,
    qty: 10,
    price: 100,
    notional: 1_000,
    commission: 0.005,
    ts,
    isoTs: new Date(ts).toISOString(),
  };
}

// ------------------------------------------------------------------
// Tests: lifecycle event emission
// ------------------------------------------------------------------

describe("Orchestrator lifecycle events", () => {
  let bus: EventBus;
  let events: TradingEvent[];

  beforeEach(() => {
    bus = new EventBus();
    events = captureEvents(bus);
  });

  it("emits ENGINE_STARTED when start() is called", () => {
    const orch = makeOrchestrator(bus);
    orch.start();

    expect(events.some((e) => e.type === "ENGINE_STARTED")).toBe(true);
  });

  it("emits STRATEGY_STARTED for every registered strategy", () => {
    const orch = makeOrchestrator(bus);
    orch.registerStrategy(makeStrategy("s1"));
    orch.registerStrategy(makeStrategy("s2"));
    orch.start();

    const started = events.filter((e) => e.type === "STRATEGY_STARTED");
    expect(started).toHaveLength(2);
    const ids = started.map((e) => (e as any).strategyId);
    expect(ids).toContain("s1");
    expect(ids).toContain("s2");
  });

  it("STRATEGY_STARTED carries the strategyType", () => {
    const orch = makeOrchestrator(bus);
    orch.registerStrategy(makeStrategy("s1"));
    orch.start();

    const ev = events.find((e) => e.type === "STRATEGY_STARTED") as any;
    expect(ev.strategyType).toBe("pairs_trading");
  });

  it("emits ENGINE_STOPPED when stop() is called", () => {
    const orch = makeOrchestrator(bus);
    orch.start();
    events.length = 0;
    orch.stop();

    expect(events.some((e) => e.type === "ENGINE_STOPPED")).toBe(true);
  });

  it("emits STRATEGY_STOPPED for every registered strategy on stop()", () => {
    const orch = makeOrchestrator(bus);
    orch.registerStrategy(makeStrategy("s1"));
    orch.registerStrategy(makeStrategy("s2"));
    orch.start();
    events.length = 0;
    orch.stop();

    const stopped = events.filter((e) => e.type === "STRATEGY_STOPPED");
    expect(stopped).toHaveLength(2);
    const ids = stopped.map((e) => (e as any).strategyId);
    expect(ids).toContain("s1");
    expect(ids).toContain("s2");
  });

  it("STRATEGY_STOPPED is emitted before ENGINE_STOPPED", () => {
    const orch = makeOrchestrator(bus);
    orch.registerStrategy(makeStrategy("s1"));
    orch.start();
    events.length = 0;
    orch.stop();

    const types = events.map((e) => e.type);
    const stoppedIdx = types.indexOf("STRATEGY_STOPPED");
    const engineIdx = types.indexOf("ENGINE_STOPPED");
    expect(stoppedIdx).toBeGreaterThanOrEqual(0);
    expect(engineIdx).toBeGreaterThan(stoppedIdx);
  });
});

// ------------------------------------------------------------------
// Tests: STRATEGY_ERROR on start() failure
// ------------------------------------------------------------------

describe("Orchestrator: STRATEGY_ERROR (phase: start)", () => {
  it("emits STRATEGY_ERROR when strategy.start() throws", () => {
    const bus = new EventBus();
    const events = captureEvents(bus);
    const orch = makeOrchestrator(bus);

    orch.registerStrategy(
      makeStrategy("s1", {
        start: jest.fn().mockImplementation(() => {
          throw new Error("init failed");
        }),
      }),
    );
    orch.start();

    const errorEvents = events.filter((e) => e.type === "STRATEGY_ERROR") as any[];
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].strategyId).toBe("s1");
    expect(errorEvents[0].phase).toBe("start");
    expect(errorEvents[0].error).toContain("init failed");
  });

  it("includes strategyName from config in STRATEGY_ERROR", () => {
    const bus = new EventBus();
    const events = captureEvents(bus);
    const orch = makeOrchestrator(bus);

    orch.registerStrategy(
      makeStrategy("s1", {
        start: jest.fn().mockImplementation(() => {
          throw new Error("boom");
        }),
      }),
    );
    orch.start();

    const ev = events.find((e) => e.type === "STRATEGY_ERROR") as any;
    expect(ev.strategyName).toBe("Strategy s1");
  });

  it("continues starting remaining strategies after one throws", () => {
    const bus = new EventBus();
    const events = captureEvents(bus);
    const orch = makeOrchestrator(bus);

    orch.registerStrategy(
      makeStrategy("bad", {
        start: jest.fn().mockImplementation(() => {
          throw new Error("fail");
        }),
      }),
    );
    orch.registerStrategy(makeStrategy("good"));
    orch.start();

    // "good" strategy should still emit STRATEGY_STARTED
    const started = events.filter((e) => e.type === "STRATEGY_STARTED") as any[];
    expect(started.some((e) => e.strategyId === "good")).toBe(true);
  });

  it("does not emit STRATEGY_STARTED for a strategy whose start() threw", () => {
    const bus = new EventBus();
    const events = captureEvents(bus);
    const orch = makeOrchestrator(bus);

    orch.registerStrategy(
      makeStrategy("bad", {
        start: jest.fn().mockImplementation(() => {
          throw new Error("fail");
        }),
      }),
    );
    orch.start();

    const started = events.filter((e) => e.type === "STRATEGY_STARTED") as any[];
    expect(started.some((e) => e.strategyId === "bad")).toBe(false);
  });

  it("still emits ENGINE_STARTED even when a strategy.start() throws", () => {
    const bus = new EventBus();
    const events = captureEvents(bus);
    const orch = makeOrchestrator(bus);

    orch.registerStrategy(
      makeStrategy("bad", {
        start: jest.fn().mockImplementation(() => {
          throw new Error("fail");
        }),
      }),
    );
    orch.start();

    expect(events.some((e) => e.type === "ENGINE_STARTED")).toBe(true);
  });
});

// ------------------------------------------------------------------
// Tests: STRATEGY_ERROR on evaluate() failure
// ------------------------------------------------------------------

describe("Orchestrator: STRATEGY_ERROR (phase: evaluate)", () => {
  function publishBar(bus: EventBus, symbol: string): void {
    const ts = Date.now();
    bus.publish({
      id: "bar-1" as UUID,
      type: "BAR_RECEIVED",
      ts,
      mode: "paper",
      payload: {
        symbol,
        open: 100, high: 101, low: 99, close: 100,
        volume: 1_000, vwap: 100, ts,
        isoTs: new Date(ts).toISOString(),
        timeframe: "1Min",
      },
    });
  }

  it("emits STRATEGY_ERROR when strategy.evaluate() throws", () => {
    const bus = new EventBus();
    const events = captureEvents(bus);
    const orch = makeOrchestrator(bus);

    orch.registerStrategy(
      makeStrategy("s1", {
        config: {
          id: "s1" as UUID,
          name: "Strategy s1",
          type: "pairs_trading",
          symbols: ["SPY"],
          rollingWindowMs: 3_600_000,
          maxPositionSizeUsd: 10_000,
          cooldownMs: 60_000,
          enabled: true,
        },
        evaluate: jest.fn().mockImplementation(() => {
          throw new Error("bad math");
        }),
      }),
    );
    orch.start();
    events.length = 0;

    publishBar(bus, "SPY");

    const errorEvents = events.filter((e) => e.type === "STRATEGY_ERROR") as any[];
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].phase).toBe("evaluate");
    expect(errorEvents[0].strategyId).toBe("s1");
    expect(errorEvents[0].error).toContain("bad math");
  });

  it("includes strategyName in evaluate-phase STRATEGY_ERROR", () => {
    const bus = new EventBus();
    const events = captureEvents(bus);
    const orch = makeOrchestrator(bus);

    orch.registerStrategy(
      makeStrategy("s1", {
        config: {
          id: "s1" as UUID,
          name: "My Named Strategy",
          type: "pairs_trading",
          symbols: ["SPY"],
          rollingWindowMs: 3_600_000,
          maxPositionSizeUsd: 10_000,
          cooldownMs: 60_000,
          enabled: true,
        },
        evaluate: jest.fn().mockImplementation(() => {
          throw new Error("fail");
        }),
      }),
    );
    orch.start();
    events.length = 0;

    publishBar(bus, "SPY");

    const ev = events.find((e) => e.type === "STRATEGY_ERROR") as any;
    expect(ev.strategyName).toBe("My Named Strategy");
  });

  it("continues evaluating remaining strategies after one throws", () => {
    const bus = new EventBus();
    const events = captureEvents(bus);
    const orch = makeOrchestrator(bus);

    const goodEvaluate = jest.fn().mockReturnValue(null);

    orch.registerStrategy(
      makeStrategy("bad", {
        config: {
          id: "bad" as UUID,
          name: "Bad",
          type: "pairs_trading",
          symbols: ["SPY"],
          rollingWindowMs: 3_600_000,
          maxPositionSizeUsd: 10_000,
          cooldownMs: 60_000,
          enabled: true,
        },
        evaluate: jest.fn().mockImplementation(() => {
          throw new Error("fail");
        }),
      }),
    );
    orch.registerStrategy(
      makeStrategy("good", {
        config: {
          id: "good" as UUID,
          name: "Good",
          type: "pairs_trading",
          symbols: ["SPY"],
          rollingWindowMs: 3_600_000,
          maxPositionSizeUsd: 10_000,
          cooldownMs: 60_000,
          enabled: true,
        },
        evaluate: goodEvaluate,
      }),
    );
    orch.start();

    publishBar(bus, "SPY");

    expect(goodEvaluate).toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------
// Tests: PORTFOLIO_UPDATED on fill
// ------------------------------------------------------------------

describe("Orchestrator: PORTFOLIO_UPDATED on ORDER_FILLED", () => {
  it("emits PORTFOLIO_UPDATED after an ORDER_FILLED event is processed", () => {
    const bus = new EventBus();
    const events = captureEvents(bus);
    const orch = makeOrchestrator(bus);
    orch.start();
    events.length = 0;

    bus.publish({
      id: "e-1" as UUID,
      type: "ORDER_FILLED",
      ts: Date.now(),
      mode: "paper",
      orderId: "order-1" as UUID,
      fill: makeFill("order-1"),
    });

    const portfolioEvents = events.filter((e) => e.type === "PORTFOLIO_UPDATED");
    expect(portfolioEvents).toHaveLength(1);
  });

  it("PORTFOLIO_UPDATED payload contains a valid PortfolioSnapshot", () => {
    const bus = new EventBus();
    const events = captureEvents(bus);
    const orch = makeOrchestrator(bus);
    orch.start();
    events.length = 0;

    bus.publish({
      id: "e-1" as UUID,
      type: "ORDER_FILLED",
      ts: Date.now(),
      mode: "paper",
      orderId: "order-1" as UUID,
      fill: makeFill("order-1"),
    });

    const ev = events.find((e) => e.type === "PORTFOLIO_UPDATED") as any;
    const snapshot = ev.payload;
    expect(snapshot).toBeDefined();
    expect(typeof snapshot.equity).toBe("number");
    expect(typeof snapshot.cash).toBe("number");
    expect(Array.isArray(snapshot.positions)).toBe(true);
  });

  it("PORTFOLIO_UPDATED equity reflects the fill (buy reduces cash)", () => {
    const bus = new EventBus();
    const events = captureEvents(bus);
    const orch = makeOrchestrator(bus);
    orch.start();
    events.length = 0;

    const fill = makeFill("order-1"); // buy 10 SPY @ 100 = $1000 + $0.005 commission

    bus.publish({
      id: "e-1" as UUID,
      type: "ORDER_FILLED",
      ts: Date.now(),
      mode: "paper",
      orderId: "order-1" as UUID,
      fill,
    });

    const ev = events.find((e) => e.type === "PORTFOLIO_UPDATED") as any;
    // Cash decreased by cost (price * qty + commission)
    expect(ev.payload.cash).toBeLessThan(100_000);
  });

  it("emits exactly one PORTFOLIO_UPDATED per ORDER_FILLED", () => {
    const bus = new EventBus();
    const events = captureEvents(bus);
    const orch = makeOrchestrator(bus);
    orch.start();
    events.length = 0;

    for (let i = 0; i < 3; i++) {
      bus.publish({
        id: `e-${i}` as UUID,
        type: "ORDER_FILLED",
        ts: Date.now(),
        mode: "paper",
        orderId: `order-${i}` as UUID,
        fill: makeFill(`order-${i}`),
      });
    }

    expect(events.filter((e) => e.type === "PORTFOLIO_UPDATED")).toHaveLength(3);
  });
});
