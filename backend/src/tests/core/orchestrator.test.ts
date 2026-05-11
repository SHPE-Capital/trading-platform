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

// ------------------------------------------------------------------
// Tests: ORDER_REJECTED handling
// ------------------------------------------------------------------

/**
 * Construct an Orchestrator and seed an Order in OrderStateManager so terminal
 * lifecycle handlers have something to transition. Returns both for inspection.
 */
function makeOrchestratorWithOrder(bus: EventBus, orderId: string, qty = 10) {
  const symbolState = new SymbolStateManager();
  const portfolioState = new PortfolioStateManager(100_000);
  const orderState = new OrderStateManager();
  const orch = new Orchestrator(
    bus,
    symbolState,
    portfolioState,
    orderState,
    new RiskEngine(),
    { submit: jest.fn() } as unknown as ExecutionEngine,
    "paper",
  );
  orderState.addOrder({
    id: orderId as UUID,
    intentId: orderId as UUID,
    strategyId: "s1",
    symbol: "SPY",
    side: "buy",
    qty,
    filledQty: 0,
    orderType: "market",
    timeInForce: "ioc",
    status: "submitted",
    submittedAt: Date.now(),
    updatedAt: Date.now(),
    fills: [],
  });
  return { orch, orderState, portfolioState };
}

describe("Orchestrator: ORDER_REJECTED", () => {
  it("transitions the order from submitted to rejected", () => {
    const bus = new EventBus();
    const { orch, orderState } = makeOrchestratorWithOrder(bus, "order-rj");
    orch.start();

    bus.publish({
      id: "e-rj" as UUID,
      type: "ORDER_REJECTED",
      ts: Date.now(),
      mode: "paper",
      orderId: "order-rj" as UUID,
      reason: "broker said no",
    });

    expect(orderState.getOrder("order-rj" as UUID)?.status).toBe("rejected");
  });

  it("does not emit PORTFOLIO_UPDATED on rejection (no fill occurred)", () => {
    const bus = new EventBus();
    const events = captureEvents(bus);
    const { orch } = makeOrchestratorWithOrder(bus, "order-rj");
    orch.start();
    events.length = 0;

    bus.publish({
      id: "e-rj" as UUID,
      type: "ORDER_REJECTED",
      ts: Date.now(),
      mode: "paper",
      orderId: "order-rj" as UUID,
      reason: "no price",
    });

    expect(events.filter((e) => e.type === "PORTFOLIO_UPDATED")).toHaveLength(0);
  });

  it("rejected order is not returned by getOpenOrders()", () => {
    const bus = new EventBus();
    const { orch, orderState } = makeOrchestratorWithOrder(bus, "order-rj");
    orch.start();

    bus.publish({
      id: "e-rj" as UUID,
      type: "ORDER_REJECTED",
      ts: Date.now(),
      mode: "paper",
      orderId: "order-rj" as UUID,
      reason: "x",
    });

    expect(orderState.getOpenOrders().map((o) => o.id)).not.toContain("order-rj");
  });
});

// ------------------------------------------------------------------
// Tests: ORDER_PARTIAL_FILL handling
// ------------------------------------------------------------------

function makePartialFill(orderId: string, qty: number, price: number) {
  const ts = Date.now();
  return {
    id: `f-${qty}-${price}` as UUID,
    orderId: orderId as UUID,
    symbol: "SPY",
    side: "buy" as const,
    qty,
    price,
    notional: qty * price,
    commission: 0,
    ts,
    isoTs: new Date(ts).toISOString(),
  };
}

describe("Orchestrator: ORDER_PARTIAL_FILL", () => {
  it("applies the delta qty to filledQty and leaves status partial_fill", () => {
    const bus = new EventBus();
    const { orch, orderState } = makeOrchestratorWithOrder(bus, "o1", 10);
    orch.start();

    bus.publish({
      id: "e1" as UUID,
      type: "ORDER_PARTIAL_FILL",
      ts: Date.now(),
      mode: "paper",
      orderId: "o1" as UUID,
      fill: makePartialFill("o1", 4, 100),
      remainingQty: 6,
    });

    const o = orderState.getOrder("o1" as UUID)!;
    expect(o.filledQty).toBe(4);
    expect(o.status).toBe("partial_fill");
  });

  it("emits PORTFOLIO_UPDATED on every partial fill", () => {
    const bus = new EventBus();
    const events = captureEvents(bus);
    const { orch } = makeOrchestratorWithOrder(bus, "o2", 10);
    orch.start();
    events.length = 0;

    bus.publish({
      id: "e1" as UUID,
      type: "ORDER_PARTIAL_FILL",
      ts: Date.now(),
      mode: "paper",
      orderId: "o2" as UUID,
      fill: makePartialFill("o2", 4, 100),
      remainingQty: 6,
    });

    expect(events.filter((e) => e.type === "PORTFOLIO_UPDATED")).toHaveLength(1);
  });

  it("partial fills then final fill produce correct cumulative filledQty without double-applying", () => {
    const bus = new EventBus();
    const { orch, orderState, portfolioState } = makeOrchestratorWithOrder(bus, "o3", 10);
    orch.start();

    // partial 1: qty 4 @ 100
    bus.publish({
      id: "p1" as UUID, type: "ORDER_PARTIAL_FILL", ts: Date.now(), mode: "paper",
      orderId: "o3" as UUID, fill: makePartialFill("o3", 4, 100), remainingQty: 6,
    });
    // partial 2: qty 3 @ 101
    bus.publish({
      id: "p2" as UUID, type: "ORDER_PARTIAL_FILL", ts: Date.now(), mode: "paper",
      orderId: "o3" as UUID, fill: makePartialFill("o3", 3, 101), remainingQty: 3,
    });
    // final fill: qty 3 @ 102
    bus.publish({
      id: "f1" as UUID, type: "ORDER_FILLED", ts: Date.now(), mode: "paper",
      orderId: "o3" as UUID, fill: makePartialFill("o3", 3, 102),
    });

    const o = orderState.getOrder("o3" as UUID)!;
    expect(o.filledQty).toBe(10);
    expect(o.status).toBe("filled");
    // Portfolio reflects 10 shares bought
    const pos = portfolioState.getPosition("SPY");
    expect(pos?.qty).toBe(10);
  });

  it("does not double-apply a terminal ORDER_FILLED if partials already reached order.qty", () => {
    const bus = new EventBus();
    const { orch, orderState, portfolioState } = makeOrchestratorWithOrder(bus, "o4", 10);
    orch.start();

    // Partials sum to full qty
    bus.publish({
      id: "p1" as UUID, type: "ORDER_PARTIAL_FILL", ts: Date.now(), mode: "paper",
      orderId: "o4" as UUID, fill: makePartialFill("o4", 6, 100), remainingQty: 4,
    });
    bus.publish({
      id: "p2" as UUID, type: "ORDER_PARTIAL_FILL", ts: Date.now(), mode: "paper",
      orderId: "o4" as UUID, fill: makePartialFill("o4", 4, 100), remainingQty: 0,
    });

    const cashAfterPartials = portfolioState.getCash();
    const posQtyAfterPartials = portfolioState.getPosition("SPY")?.qty ?? 0;

    // A redundant terminal fill that would double-count if not guarded
    bus.publish({
      id: "f1" as UUID, type: "ORDER_FILLED", ts: Date.now(), mode: "paper",
      orderId: "o4" as UUID, fill: makePartialFill("o4", 10, 100),
    });

    const o = orderState.getOrder("o4" as UUID)!;
    expect(o.filledQty).toBe(10);
    expect(portfolioState.getCash()).toBe(cashAfterPartials);
    expect(portfolioState.getPosition("SPY")?.qty).toBe(posQtyAfterPartials);
  });
});

// ------------------------------------------------------------------
// Tests: ORDER_EXPIRED handling
// ------------------------------------------------------------------

describe("Orchestrator: ORDER_EXPIRED", () => {
  it("transitions an expired order out of the open-orders set", () => {
    const bus = new EventBus();
    const { orch, orderState } = makeOrchestratorWithOrder(bus, "o-exp");
    orch.start();

    bus.publish({
      id: "e-exp" as UUID, type: "ORDER_EXPIRED", ts: Date.now(),
      mode: "paper", orderId: "o-exp" as UUID,
    });

    expect(orderState.getOrder("o-exp" as UUID)?.status).not.toBe("submitted");
    expect(orderState.getOpenOrders().map((o) => o.id)).not.toContain("o-exp");
  });
});
