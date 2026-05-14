/**
 * tests/core/orchestratorMakerQuotes.test.ts
 *
 * Tests the Orchestrator's handling of two-sided market-making signals
 * (signal.meta.kind === "maker_quotes"). The contract is:
 *
 *   - One ORDER_INTENT_CREATED is emitted per leg of meta.makerQuotes
 *   - Each intent is a LIMIT order with the leg's side / price / qty
 *   - meta.timeInForce is honored on every intent (defaults to "day")
 *   - An empty makerQuotes array emits no intents
 */

// Mock env — required because logger.ts pulls env at import time
jest.mock("../../config/env", () => ({
  env: {
    alpacaApiKey: "k", alpacaApiSecret: "s", alpacaTradingMode: "paper",
    alpacaPaperBaseUrl: "x", alpacaLiveBaseUrl: "x",
    alpacaDataStreamUrl: "x", alpacaPaperStreamUrl: "x", alpacaLiveStreamUrl: "x",
    supabaseUrl: "x", supabaseAnonKey: "x", supabaseServiceRoleKey: "x",
    port: 8080, nodeEnv: "test", corsOrigin: "x", logLevel: "error",
    defaultRollingWindowMs: 60_000, maxPositionSizeUsd: 10_000,
    maxNotionalExposureUsd: 50_000, orderCooldownMs: 5_000,
    enableLiveTrading: false, enableWebSocketPush: true, databaseUrl: "",
  },
}));

import { EventBus } from "../../core/engine/eventBus";
import { Orchestrator } from "../../core/engine/orchestrator";
import { SymbolStateManager } from "../../core/state/symbolState";
import { PortfolioStateManager } from "../../core/state/portfolioState";
import { OrderStateManager } from "../../core/state/orderState";
import { RiskEngine } from "../../core/risk/riskEngine";
import { ExecutionEngine } from "../../core/execution/executionEngine";
import type { TradingEvent, OrderIntentCreatedEvent } from "../../types/events";

function makeOrchestrator(bus: EventBus): Orchestrator {
  return new Orchestrator(
    bus,
    new SymbolStateManager(),
    new PortfolioStateManager(100_000),
    new OrderStateManager(),
    new RiskEngine(),
    { submit: jest.fn() } as unknown as ExecutionEngine,
    "backtest",
  );
}

function captureEvents(bus: EventBus): TradingEvent[] {
  const events: TradingEvent[] = [];
  bus.onAll((e) => { events.push(e); });
  return events;
}

function makeMakerQuoteSignal(quotes: Array<{ side: "buy" | "sell"; price: number; qty: number }>) {
  return {
    id: "sig-1",
    strategyId: "strat-1",
    strategyType: "market_making",
    symbol: "AAPL",
    direction: "flat",
    qty: quotes.reduce((s, q) => s + q.qty, 0),
    triggerLabel: "as_quote",
    ts: Date.now(),
    meta: {
      kind: "maker_quotes",
      makerQuotes: quotes,
      timeInForce: "day",
      reservationPrice: 100,
      halfSpread: 0.05,
      sigma: 0.001,
      inventory: 0,
      midPrice: 100,
    },
  };
}

describe("Orchestrator: maker_quotes signal routing", () => {
  it("emits one ORDER_INTENT_CREATED per maker quote leg", () => {
    const bus = new EventBus();
    const orch = makeOrchestrator(bus);
    orch.start();
    const events = captureEvents(bus);

    bus.publish({
      id: "e1",
      type: "STRATEGY_SIGNAL_CREATED",
      ts: Date.now(),
      mode: "backtest",
      strategyId: "strat-1",
      payload: makeMakerQuoteSignal([
        { side: "buy", price: 99.95, qty: 10 },
        { side: "sell", price: 100.05, qty: 10 },
      ]),
    } as TradingEvent);

    const intents = events.filter((e): e is OrderIntentCreatedEvent => e.type === "ORDER_INTENT_CREATED");
    expect(intents).toHaveLength(2);
    const buy = intents.find((i) => i.payload.side === "buy")!;
    const sell = intents.find((i) => i.payload.side === "sell")!;
    expect(buy.payload.orderType).toBe("limit");
    expect(buy.payload.limitPrice).toBe(99.95);
    expect(buy.payload.qty).toBe(10);
    expect(buy.payload.timeInForce).toBe("day");
    expect(sell.payload.orderType).toBe("limit");
    expect(sell.payload.limitPrice).toBe(100.05);
    expect(sell.payload.timeInForce).toBe("day");
  });

  it("emits no intents when makerQuotes is empty (kill-switch)", () => {
    const bus = new EventBus();
    const orch = makeOrchestrator(bus);
    orch.start();
    const events = captureEvents(bus);

    bus.publish({
      id: "e1",
      type: "STRATEGY_SIGNAL_CREATED",
      ts: Date.now(),
      mode: "backtest",
      strategyId: "strat-1",
      payload: makeMakerQuoteSignal([]),
    } as TradingEvent);

    const intents = events.filter((e) => e.type === "ORDER_INTENT_CREATED");
    expect(intents).toHaveLength(0);
  });

  it("emits a single intent when one side is suppressed (inventory cap)", () => {
    const bus = new EventBus();
    const orch = makeOrchestrator(bus);
    orch.start();
    const events = captureEvents(bus);

    bus.publish({
      id: "e1",
      type: "STRATEGY_SIGNAL_CREATED",
      ts: Date.now(),
      mode: "backtest",
      strategyId: "strat-1",
      payload: makeMakerQuoteSignal([{ side: "sell", price: 100.10, qty: 5 }]),
    } as TradingEvent);

    const intents = events.filter((e): e is OrderIntentCreatedEvent => e.type === "ORDER_INTENT_CREATED");
    expect(intents).toHaveLength(1);
    expect(intents[0].payload.side).toBe("sell");
    expect(intents[0].payload.orderType).toBe("limit");
  });

  it("skips legs with non-positive qty or invalid price", () => {
    const bus = new EventBus();
    const orch = makeOrchestrator(bus);
    orch.start();
    const events = captureEvents(bus);

    bus.publish({
      id: "e1",
      type: "STRATEGY_SIGNAL_CREATED",
      ts: Date.now(),
      mode: "backtest",
      strategyId: "strat-1",
      payload: makeMakerQuoteSignal([
        { side: "buy", price: 100, qty: 0 },          // skipped: qty 0
        { side: "sell", price: -1, qty: 5 },           // skipped: bad price
        { side: "sell", price: 100.05, qty: 5 },       // kept
      ]),
    } as TradingEvent);

    const intents = events.filter((e) => e.type === "ORDER_INTENT_CREATED");
    expect(intents).toHaveLength(1);
  });
});
