/**
 * tests/core/portfolioUpdatedOnDemand.test.ts
 *
 * After a fill the orchestrator used to build a full portfolio snapshot for
 * PORTFOLIO_UPDATED even when nothing listened (every backtest). It now builds
 * it only for subscribers; the post-fill risk check is unaffected.
 */

import { EventBus } from "../../core/engine/eventBus";
import { Orchestrator } from "../../core/engine/orchestrator";
import { SymbolStateManager } from "../../core/state/symbolState";
import { PortfolioStateManager } from "../../core/state/portfolioState";
import { OrderStateManager } from "../../core/state/orderState";
import { RiskEngine } from "../../core/risk/riskEngine";
import type { ExecutionEngine } from "../../core/execution/executionEngine";
import type { Fill } from "../../types/orders";

function fillEvent(qty: number, price: number) {
  const fill = { id: "f", orderId: "o1", symbol: "SPY", side: "buy", qty, price, notional: qty * price, commission: 0, ts: 1, isoTs: "" } as Fill;
  return { id: "e", type: "ORDER_FILLED" as const, ts: 1, mode: "backtest" as const, orderId: "o1", fill };
}

function setup(risk = new RiskEngine()) {
  const bus = new EventBus();
  const portfolio = new PortfolioStateManager(100_000);
  const orch = new Orchestrator(bus, new SymbolStateManager(), portfolio, new OrderStateManager(), risk,
    { submit: jest.fn() } as unknown as ExecutionEngine, "backtest");
  orch.start();
  return { bus, portfolio };
}

describe("PORTFOLIO_UPDATED is built on demand", () => {
  it("hasSubscribers sees typed and wildcard handlers", () => {
    const bus = new EventBus();
    expect(bus.hasSubscribers("PORTFOLIO_UPDATED")).toBe(false);
    const h = (): void => {};
    bus.on("PORTFOLIO_UPDATED", h);
    expect(bus.hasSubscribers("PORTFOLIO_UPDATED")).toBe(true);
    bus.off("PORTFOLIO_UPDATED", h);
    expect(bus.hasSubscribers("PORTFOLIO_UPDATED")).toBe(false);
    bus.onAll(h);
    expect(bus.hasSubscribers("PORTFOLIO_UPDATED")).toBe(true);
  });

  it("skips the snapshot without subscribers, publishes it with one", () => {
    const { bus, portfolio } = setup();
    const spy = jest.spyOn(portfolio, "getSnapshot");
    bus.publish(fillEvent(10, 100));
    expect(spy).not.toHaveBeenCalled();

    const seen: number[] = [];
    bus.on("PORTFOLIO_UPDATED", (e) => { seen.push((e as { payload: { cash: number } }).payload.cash); });
    bus.publish({ ...fillEvent(5, 100), orderId: "o2", fill: { ...fillEvent(5, 100).fill, orderId: "o2" } });
    expect(seen).toEqual([100_000 - 1_500]);
  });

  it("still runs the post-fill risk check (kill switch) with no subscribers", () => {
    const risk = new RiskEngine({ maxGrossExposurePct: 0.5 });
    const { bus } = setup(risk);
    const violations: string[] = [];
    bus.on("PORTFOLIO_RISK_VIOLATION", (e) => { violations.push((e as { check: string }).check); });
    bus.publish(fillEvent(900, 100));
    expect(violations).toEqual(["MAX_GROSS_EXPOSURE"]);
  });
});
