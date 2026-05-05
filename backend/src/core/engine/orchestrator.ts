/**
 * core/engine/orchestrator.ts
 *
 * The main trading engine orchestrator. Wires together the EventBus,
 * SymbolStateManager, StrategyRunner, RiskEngine, and ExecutionEngine.
 * Handles the full event pipeline from market data arrival to order submission.
 *
 * This class is mode-agnostic: the same orchestrator runs in live, backtest,
 * and replay modes. What differs is the event source and execution sink
 * injected at startup.
 *
 * Inputs:  EventBus events from any source (live, historical, replay).
 * Outputs: Coordinates state updates → strategy evaluation → risk → execution.
 */

import { EventBus } from "./eventBus";
import { SymbolStateManager } from "../state/symbolState";
import { PortfolioStateManager } from "../state/portfolioState";
import { OrderStateManager } from "../state/orderState";
import { RiskEngine } from "../risk/riskEngine";
import { ExecutionEngine } from "../execution/executionEngine";
import { logger } from "../../utils/logger";
import { nowMs } from "../../utils/time";
import { newId } from "../../utils/ids";
import type { IStrategy } from "../../strategies/base/strategy";
import type { ExecutionMode } from "../../types/common";
import type {
  QuoteReceivedEvent,
  TradeReceivedEvent,
  BarReceivedEvent,
  OrderIntentCreatedEvent,
  OrderFilledEvent,
  OrderCanceledEvent,
} from "../../types/events";

export class Orchestrator {
  private strategies: Map<string, IStrategy> = new Map();
  private running = false;

  constructor(
    public readonly eventBus: EventBus,
    public readonly symbolState: SymbolStateManager,
    public readonly portfolioState: PortfolioStateManager,
    public readonly orderState: OrderStateManager,
    public readonly riskEngine: RiskEngine,
    public readonly executionEngine: ExecutionEngine,
    private readonly mode: ExecutionMode,
  ) {}

  /**
   * Registers a strategy with the orchestrator and starts it.
   * @param strategy - Any IStrategy implementation
   */
  registerStrategy(strategy: IStrategy): void {
    this.strategies.set(strategy.id, strategy);
    logger.info("Orchestrator: strategy registered", {
      strategyId: strategy.id,
      type: strategy.type,
    });
  }

  /**
   * Removes and stops a strategy by ID.
   * @param strategyId - ID of the strategy to deregister
   */
  deregisterStrategy(strategyId: string): void {
    const strategy = this.strategies.get(strategyId);
    if (strategy) {
      strategy.stop();
      this.strategies.delete(strategyId);
    }
  }

  /**
   * Starts the orchestrator: wires all EventBus listeners and starts strategies.
   * After this call, the orchestrator reacts to incoming events.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Wire market data → state update → strategy evaluation
    this.eventBus.on("QUOTE_RECEIVED", (e) => this._onQuote(e as QuoteReceivedEvent));
    this.eventBus.on("TRADE_RECEIVED", (e) => this._onTrade(e as TradeReceivedEvent));
    this.eventBus.on("BAR_RECEIVED", (e) => this._onBar(e as BarReceivedEvent));

    // Listen to signals to generate intents
    this.eventBus.on("STRATEGY_SIGNAL_CREATED", (e) => this._onStrategySignal(e as any));

    // Wire order intent → risk → execution
    this.eventBus.on("ORDER_INTENT_CREATED", (e) => this._onOrderIntent(e as OrderIntentCreatedEvent));

    // Wire fills and state updates back into portfolio and order state
    this.eventBus.on("ORDER_SUBMITTED", (e) => this._onOrderSubmitted(e as any));
    this.eventBus.on("ORDER_FILLED", (e) => this._onOrderFilled(e as OrderFilledEvent));
    this.eventBus.on("ORDER_CANCELED", (e) => this._onOrderCanceled(e as OrderCanceledEvent));

    // Start all registered strategies and emit per-strategy lifecycle events
    for (const strategy of this.strategies.values()) {
      try {
        strategy.start();
        this.eventBus.publish({
          id: newId(), type: "STRATEGY_STARTED", ts: nowMs(), mode: this.mode,
          strategyId: strategy.id, strategyType: strategy.type,
        });
      } catch (err) {
        logger.error("Orchestrator: strategy.start threw", { strategyId: strategy.id, error: String(err) });
        this.eventBus.publish({
          id: newId(), type: "STRATEGY_ERROR", ts: nowMs(), mode: this.mode,
          strategyId: strategy.id, strategyName: strategy.config.name,
          error: String(err), phase: "start",
        });
      }
    }

    this.eventBus.publish({
      id: newId(),
      type: "ENGINE_STARTED",
      ts: nowMs(),
      mode: this.mode,
    });

    logger.info("Orchestrator: started", { mode: this.mode });
  }

  /**
   * Stops the orchestrator and all registered strategies.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    for (const strategy of this.strategies.values()) {
      strategy.stop();
      this.eventBus.publish({
        id: newId(), type: "STRATEGY_STOPPED", ts: nowMs(), mode: this.mode,
        strategyId: strategy.id,
      });
    }

    this.eventBus.publish({
      id: newId(),
      type: "ENGINE_STOPPED",
      ts: nowMs(),
      mode: this.mode,
    });

    logger.info("Orchestrator: stopped");
  }

  /** Returns whether the orchestrator is currently running */
  get isRunning(): boolean {
    return this.running;
  }

  // ------------------------------------------------------------------
  // Private event handlers
  // ------------------------------------------------------------------

  private _onQuote(event: QuoteReceivedEvent): void {
    this.symbolState.onQuote(event.payload);
    this._evaluateStrategies(event.payload.symbol);
  }

  private _onTrade(event: TradeReceivedEvent): void {
    this.symbolState.onTrade(event.payload);
    this._evaluateStrategies(event.payload.symbol);
  }

  private _onBar(event: BarReceivedEvent): void {
    this.symbolState.onBar(event.payload);
    this._evaluateStrategies(event.payload.symbol);
  }

  private _evaluateStrategies(symbol: string): void {
    for (const strategy of this.strategies.values()) {
      if (!strategy.config.symbols.includes(symbol)) continue;
      try {
        const signal = strategy.evaluate({
          symbolState: this.symbolState,
          portfolioState: this.portfolioState,
          orderState: this.orderState,
          symbol,
        });
        if (signal) {
          this.eventBus.publish({
            id: newId(),
            type: "STRATEGY_SIGNAL_CREATED",
            ts: nowMs(),
            mode: this.mode,
            strategyId: strategy.id,
            payload: signal,
          });
        }
      } catch (err) {
        const error = String(err);
        logger.error("Orchestrator: strategy.evaluate threw", { strategyId: strategy.id, error });
        this.eventBus.publish({
          id: newId(), type: "STRATEGY_ERROR", ts: nowMs(), mode: this.mode,
          strategyId: strategy.id, strategyName: strategy.config.name,
          error, phase: "evaluate",
        });
      }
    }
  }

  /**
   * Converts emitted StrategySignals into actionable OrderIntents.
   * This currently serves both backtest mode and any future live integration.
   * TODO: Revisit this routing logic when live order flow is fully wired up, 
   * to ensure live execution doesn't require a separate dedicated signal router.
   */
  private _onStrategySignal(event: any): void {
    const signal = event.payload;
    if (!signal || signal.qty <= 0) return;

    let side: "buy" | "sell";
    if (signal.direction === "long" || signal.direction === "close_short") side = "buy";
    else if (signal.direction === "short" || signal.direction === "close_long") side = "sell";
    else return;

    const intent = {
      id: newId(),
      strategyId: signal.strategyId,
      symbol: signal.symbol,
      side,
      qty: signal.qty,
      orderType: "market" as const,
      timeInForce: "ioc" as const,
      reason: signal.triggerLabel,
      ts: nowMs(),
    };

    this.eventBus.publish({
      id: newId(),
      type: "ORDER_INTENT_CREATED",
      ts: nowMs(),
      mode: event.mode,
      strategyId: signal.strategyId,
      payload: intent,
    });
    
    if (signal.meta && signal.meta.counterpartSymbol && signal.meta.counterpartDirection) {
      let cSide: "buy" | "sell";
      const cDir = signal.meta.counterpartDirection as string;
      if (cDir === "long" || cDir === "close_short") cSide = "buy";
      else if (cDir === "short" || cDir === "close_long") cSide = "sell";
      else return;
      
      const cIntent = {
        id: newId(),
        strategyId: signal.strategyId,
        symbol: signal.meta.counterpartSymbol as string,
        side: cSide,
        qty: Math.floor(signal.qty * ((signal.meta.hedgeRatio as number) || 1)),
        orderType: "market" as const,
        timeInForce: "ioc" as const,
        reason: (signal.triggerLabel || "") + "_counterpart",
        ts: nowMs(),
      };

      // Ensure counterpart qty > 0 to avoid rejection
      if (cIntent.qty > 0) {
        this.eventBus.publish({
          id: newId(),
          type: "ORDER_INTENT_CREATED",
          ts: nowMs(),
          mode: event.mode,
          strategyId: signal.strategyId,
          payload: cIntent,
        });
      }
    }
  }

  private _onOrderIntent(event: OrderIntentCreatedEvent): void {
    const riskResult = this.riskEngine.check(event.payload, this.portfolioState.getSnapshot());
    if (!riskResult.passed) {
      this.eventBus.publish({
        id: newId(),
        type: "RISK_REJECTED",
        ts: nowMs(),
        mode: this.mode,
        strategyId: event.strategyId,
        reason: riskResult.reason ?? "Risk check failed",
        rejectedIntent: event.payload,
      });
      return;
    }
    this.executionEngine.submit(event.payload);
  }

  private _onOrderSubmitted(event: any): void {
    this.orderState.addOrder(event.payload);
  }

  private _onOrderFilled(event: OrderFilledEvent): void {
    this.orderState.applyFill(event.orderId, event.fill);
    this.portfolioState.applyFill(event.fill);
    this.eventBus.publish({
      id: newId(), type: "PORTFOLIO_UPDATED", ts: nowMs(), mode: this.mode,
      payload: this.portfolioState.getSnapshot(),
    });
  }

  private _onOrderCanceled(event: OrderCanceledEvent): void {
    this.orderState.markCanceled(event.orderId);
  }
}
