/**
 * tests/core/orchestratorAutoDisable.test.ts
 *
 * Part 05 blast-radius control and Part 06 rejection attribution:
 *   - N consecutive evaluate() errors deregister the strategy and emit
 *     STRATEGY_AUTO_DISABLED; a clean evaluate in between resets the count
 *   - with no limit configured (backtests), a failing strategy is never removed
 *   - RISK_REJECTED names the check that fired
 */

import { EventBus } from "../../core/engine/eventBus";
import { Orchestrator, type OrchestratorOptions } from "../../core/engine/orchestrator";
import { SymbolStateManager } from "../../core/state/symbolState";
import { PortfolioStateManager } from "../../core/state/portfolioState";
import { OrderStateManager } from "../../core/state/orderState";
import { RiskEngine } from "../../core/risk/riskEngine";
import type { ExecutionEngine } from "../../core/execution/executionEngine";
import type { IStrategy } from "../../strategies/base/strategy";
import type { TradingEvent } from "../../types/events";
import type { UUID } from "../../types/common";

function capture(bus: EventBus): TradingEvent[] {
  const events: TradingEvent[] = [];
  bus.onAll((e) => { events.push(e); });
  return events;
}

function strategy(id: string, evaluate: jest.Mock): IStrategy {
  return {
    id: id as UUID,
    type: "pairs_trading",
    config: {
      id: id as UUID,
      name: `Strategy ${id}`,
      type: "pairs_trading",
      symbols: ["SPY"],
      rollingWindowMs: 3_600_000,
      maxPositionSizeUsd: 10_000,
      cooldownMs: 60_000,
      enabled: true,
    },
    start: jest.fn(),
    stop: jest.fn(),
    evaluate,
  };
}

function orchestrator(bus: EventBus, options?: OrchestratorOptions, risk = new RiskEngine()): Orchestrator {
  return new Orchestrator(
    bus,
    new SymbolStateManager(),
    new PortfolioStateManager(100_000),
    new OrderStateManager(),
    risk,
    { submit: jest.fn().mockResolvedValue(undefined) } as unknown as ExecutionEngine,
    "paper",
    options,
  );
}

function bar(bus: EventBus, symbol = "SPY", close = 100): void {
  const ts = Date.now();
  bus.publish({
    id: `bar-${Math.random()}` as UUID,
    type: "BAR_RECEIVED",
    ts,
    mode: "paper",
    payload: { symbol, open: close, high: close, low: close, close, volume: 1, ts, isoTs: new Date(ts).toISOString(), timeframe: "1Min" },
  });
}

const boom = () => { throw new Error("boom"); };

describe("Orchestrator: auto-disable after consecutive errors", () => {
  it("deregisters the strategy on the Nth error in a row and says why", () => {
    const bus = new EventBus();
    const events = capture(bus);
    const orch = orchestrator(bus, { maxConsecutiveErrors: 3 });
    orch.registerStrategy(strategy("s1", jest.fn(boom)), "run-1");
    orch.start();

    bar(bus); bar(bus);
    expect(orch.hasStrategy("run-1")).toBe(true);
    bar(bus);

    expect(orch.hasStrategy("run-1")).toBe(false);
    const disabled = events.find((e) => e.type === "STRATEGY_AUTO_DISABLED") as unknown as Record<string, unknown>;
    expect(disabled).toMatchObject({ runKey: "run-1", strategyId: "s1", consecutiveErrors: 3 });
    expect(String(disabled.lastError)).toContain("boom");
  });

  it("reports the running count and the registry key on each STRATEGY_ERROR", () => {
    const bus = new EventBus();
    const events = capture(bus);
    const orch = orchestrator(bus, { maxConsecutiveErrors: 5 });
    orch.registerStrategy(strategy("s1", jest.fn(boom)), "run-1");
    orch.start();

    bar(bus); bar(bus);

    const errors = events.filter((e) => e.type === "STRATEGY_ERROR") as unknown as Record<string, unknown>[];
    expect(errors.map((e) => e.consecutiveErrors)).toEqual([1, 2]);
    expect(errors.every((e) => e.runKey === "run-1")).toBe(true);
  });

  it("resets the streak — and says so — after a clean evaluate", () => {
    const bus = new EventBus();
    const events = capture(bus);
    const evaluate = jest.fn()
      .mockImplementationOnce(boom)
      .mockImplementationOnce(boom)
      .mockReturnValueOnce(null)
      .mockImplementation(boom);
    const orch = orchestrator(bus, { maxConsecutiveErrors: 3 });
    orch.registerStrategy(strategy("s1", evaluate), "run-1");
    orch.start();

    bar(bus); bar(bus); // 2 errors
    bar(bus);           // clean → reset
    bar(bus); bar(bus); // 2 errors again

    expect(orch.hasStrategy("run-1")).toBe(true);
    expect(events.filter((e) => e.type === "STRATEGY_RECOVERED")).toHaveLength(1);
    expect(events.some((e) => e.type === "STRATEGY_AUTO_DISABLED")).toBe(false);
  });

  it("never removes a strategy when no limit is configured (backtests)", () => {
    const bus = new EventBus();
    const events = capture(bus);
    const orch = orchestrator(bus);
    orch.registerStrategy(strategy("s1", jest.fn(boom)), "run-1");
    orch.start();

    for (let i = 0; i < 20; i++) bar(bus);

    expect(orch.hasStrategy("run-1")).toBe(true);
    expect(events.some((e) => e.type === "STRATEGY_AUTO_DISABLED")).toBe(false);
  });

  it("keeps evaluating the healthy strategies when one is disabled", () => {
    const bus = new EventBus();
    const orch = orchestrator(bus, { maxConsecutiveErrors: 1 });
    const good = jest.fn().mockReturnValue(null);
    orch.registerStrategy(strategy("bad", jest.fn(boom)), "run-bad");
    orch.registerStrategy(strategy("good", good), "run-good");
    orch.start();

    bar(bus); bar(bus);

    expect(orch.hasStrategy("run-bad")).toBe(false);
    expect(good).toHaveBeenCalledTimes(2);
  });
});

describe("Orchestrator: RISK_REJECTED names the failed check", () => {
  it("carries failedCheck from the risk engine", () => {
    const bus = new EventBus();
    const events = capture(bus);
    const risk = new RiskEngine();
    risk.setKillSwitch(true);
    const orch = orchestrator(bus, {}, risk);
    orch.start();

    bus.publish({
      id: "evt-1" as UUID,
      type: "ORDER_INTENT_CREATED",
      ts: Date.now(),
      mode: "paper",
      strategyId: "s1",
      payload: {
        id: "intent-1" as UUID,
        strategyId: "s1",
        symbol: "SPY",
        side: "buy",
        qty: 1,
        orderType: "market",
        timeInForce: "ioc",
        ts: Date.now(),
      },
    });

    const rejected = events.find((e) => e.type === "RISK_REJECTED") as unknown as Record<string, unknown>;
    expect(rejected.failedCheck).toBe("KILL_SWITCH");
  });
});
