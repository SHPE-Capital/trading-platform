import { EventBus } from "../../core/engine/eventBus";
import { Orchestrator } from "../../core/engine/orchestrator";
import { SymbolStateManager } from "../../core/state/symbolState";
import { PortfolioStateManager } from "../../core/state/portfolioState";
import { OrderStateManager } from "../../core/state/orderState";
import { RiskEngine } from "../../core/risk/riskEngine";
import { buildClientOrderId, parseClientOrderId, isUuid } from "../../core/ledger/clientOrderId";
import type { ExecutionEngine } from "../../core/execution/executionEngine";
import type { IStrategy } from "../../strategies/base/strategy";
import type { OrderIntent } from "../../types/orders";
import type { UUID } from "../../types/common";

const RUN_ID = "72afe3e1-294c-4ab7-a4f6-49e57151081b";
const INTENT_ID = "e08903f4-5e1d-4c14-9e81-cc510bb25882";

describe("client order ids", () => {
  it("carries the run in front of the intent id", () => {
    expect(buildClientOrderId(INTENT_ID, RUN_ID)).toBe(`${RUN_ID}:${INTENT_ID}`);
    expect(parseClientOrderId(`${RUN_ID}:${INTENT_ID}`)).toEqual({ runId: RUN_ID, intentId: INTENT_ID });
  });

  it("reads a legacy bare intent id as having no run", () => {
    expect(buildClientOrderId(INTENT_ID)).toBe(INTENT_ID);
    expect(parseClientOrderId(INTENT_ID)).toEqual({ runId: null, intentId: INTENT_ID });
  });

  it("does not mistake a colon in a hand-made id for a run", () => {
    expect(parseClientOrderId("manual:order-1")).toEqual({ runId: null, intentId: "manual:order-1" });
  });

  it("fits Alpaca's 128-character limit", () => {
    expect(buildClientOrderId(INTENT_ID, RUN_ID).length).toBeLessThanOrEqual(128);
    expect(isUuid(RUN_ID)).toBe(true);
  });
});

describe("Orchestrator: intents carry their run, signal, and decision price", () => {
  function setup(runId?: string) {
    const bus = new EventBus();
    const submit = jest.fn(async (intent: OrderIntent) => ({ ...intent }));
    const orchestrator = new Orchestrator(
      bus, new SymbolStateManager(), new PortfolioStateManager(100_000), new OrderStateManager(),
      new RiskEngine(), { submit } as unknown as ExecutionEngine, "paper",
    );
    let fired = false;
    const strategy: IStrategy = {
      id: "cfg-1" as UUID,
      type: "minute_reversal",
      config: { id: "cfg-1" as UUID, name: "t", type: "minute_reversal", symbols: ["F"], rollingWindowMs: 60_000, maxPositionSizeUsd: 10_000, cooldownMs: 0, enabled: true },
      start: jest.fn(), stop: jest.fn(),
      evaluate: jest.fn(() => {
        if (fired) return null;
        fired = true;
        return { strategyId: "cfg-1", symbol: "F", direction: "long", qty: 1, triggerLabel: "t", ts: Date.now() } as never;
      }),
    };
    orchestrator.registerStrategy(strategy, runId);
    orchestrator.start();
    const bar = { symbol: "F", open: 12, high: 12, low: 12, close: 12, volume: 1, ts: Date.now(), isoTs: new Date().toISOString(), timeframe: "1m" };
    bus.publish({ id: "e1", type: "BAR_RECEIVED", ts: Date.now(), mode: "paper", payload: bar } as never);
    return submit;
  }

  it("tags a run-managed strategy's intent with the run, the signal, and the price it acted on", () => {
    const submit = setup(RUN_ID);
    expect(submit).toHaveBeenCalledTimes(1);
    const intent = submit.mock.calls[0][0];
    expect(intent.runId).toBe(RUN_ID);
    expect(isUuid(intent.signalId!)).toBe(true);
    expect(intent.decisionPrice).toBe(12);
  });

  it("leaves runId unset for a strategy registered without a run (backtests)", () => {
    const submit = setup();
    const intent = submit.mock.calls[0][0];
    expect(intent.runId).toBeUndefined();
    expect(intent.signalId).toBeDefined();
  });
});
