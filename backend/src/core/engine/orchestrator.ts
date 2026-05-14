/**
 * core/engine/orchestrator.ts
 *
 * The main trading engine orchestrator. Wires together the EventBus,
 * SymbolStateManager, StrategyRunner, RiskEngine, ExecutionEngine, and
 * OrderManagerService (OMS).
 *
 * Handles the full event pipeline from market data arrival to order submission.
 * Signals are routed through the OMS for capital reservation and priority-based
 * conflict resolution before reaching the execution layer.
 *
 * This class is mode-agnostic: the same orchestrator runs in live, backtest,
 * and replay modes. What differs is the event source and execution sink
 * injected at startup.
 *
 * Inputs:  EventBus events from any source (live, historical, replay).
 * Outputs: Coordinates state updates → strategy evaluation → OMS → risk → execution.
 */

import { EventBus } from "./eventBus";
import { SymbolStateManager } from "../state/symbolState";
import { PortfolioStateManager } from "../state/portfolioState";
import { OrderStateManager } from "../state/orderState";
import { RiskEngine } from "../risk/riskEngine";
import { ExecutionEngine } from "../execution/executionEngine";
import { OrderManagerService } from "../oms/orderManager";
import { CapitalReservationManager } from "../oms/capitalReservation";
import { OrderIntentQueue } from "../oms/orderQueue";
import { getSignalPriority } from "../oms/priorityConfig";
import { logger } from "../../utils/logger";
import { nowMs } from "../../utils/time";
import { newId } from "../../utils/ids";
import type { IStrategy } from "../../strategies/base/strategy";
import type { ExecutionMode } from "../../types/common";
import type { SignalGroup } from "../../types/oms";
import type {
  QuoteReceivedEvent,
  TradeReceivedEvent,
  BarReceivedEvent,
  OrderFilledEvent,
  OrderPartialFillEvent,
  OrderCanceledEvent,
  OrderRejectedEvent,
  OrderExpiredEvent,
} from "../../types/events";

export class Orchestrator {
  private strategies: Map<string, IStrategy> = new Map();
  private running = false;

  /** The Order Management System for capital reservation and priority queue */
  public readonly orderManager: OrderManagerService;

  constructor(
    public readonly eventBus: EventBus,
    public readonly symbolState: SymbolStateManager,
    public readonly portfolioState: PortfolioStateManager,
    public readonly orderState: OrderStateManager,
    public readonly riskEngine: RiskEngine,
    public readonly executionEngine: ExecutionEngine,
    private readonly mode: ExecutionMode,
  ) {
    // Build the OMS from existing dependencies
    const capitalMgr = new CapitalReservationManager();
    const queue = new OrderIntentQueue();
    this.orderManager = new OrderManagerService(
      capitalMgr,
      queue,
      riskEngine,
      executionEngine,
      portfolioState,
      symbolState,
      eventBus,
      mode,
    );
  }

  /**
   * Registers a strategy. If the orchestrator is already running, starts the
   * strategy immediately and emits STRATEGY_STARTED (or STRATEGY_ERROR on failure).
   * @param strategy - Any IStrategy implementation
   */
  registerStrategy(strategy: IStrategy): void {
    this.strategies.set(strategy.id, strategy);
    logger.info("Orchestrator: strategy registered", {
      strategyId: strategy.id,
      type: strategy.type,
    });

    if (this.running) {
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
  }

  /**
   * Removes and stops a strategy by ID. Returns true if the strategy was found.
   * @param strategyId - ID of the strategy to deregister
   */
  deregisterStrategy(strategyId: string): boolean {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) return false;
    strategy.stop();
    this.strategies.delete(strategyId);
    this.eventBus.publish({
      id: newId(), type: "STRATEGY_STOPPED", ts: nowMs(), mode: this.mode,
      strategyId: strategy.id,
    });
    return true;
  }

  /** Returns true if a strategy with the given ID is currently registered. */
  hasStrategy(strategyId: string): boolean {
    return this.strategies.has(strategyId);
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

    // Listen to signals to generate intents → route through OMS
    this.eventBus.on("STRATEGY_SIGNAL_CREATED", (e) => this._onStrategySignal(e as any));

    // Wire fills and state updates back into portfolio, order state, and OMS
    this.eventBus.on("ORDER_SUBMITTED", (e) => this._onOrderSubmitted(e as any));
    this.eventBus.on("ORDER_PARTIAL_FILL", (e) => this._onOrderPartialFill(e as OrderPartialFillEvent));
    this.eventBus.on("ORDER_FILLED", (e) => this._onOrderFilled(e as OrderFilledEvent));
    this.eventBus.on("ORDER_CANCELED", (e) => this._onOrderCanceled(e as OrderCanceledEvent));
    this.eventBus.on("ORDER_REJECTED", (e) => this._onOrderRejected(e as OrderRejectedEvent));
    this.eventBus.on("ORDER_EXPIRED", (e) => this._onOrderExpired(e as OrderExpiredEvent));

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
   * Stops the orchestrator, all registered strategies, and the OMS.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    // Clear OMS state (pending queue + reservations)
    this.orderManager.clear();

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
   * Converts emitted StrategySignals into actionable OrderIntents and routes
   * them through the OMS for capital reservation and priority-based execution.
   *
   * Multi-leg signals (e.g., pairs trades with counterpart orders) are grouped
   * into a single SignalGroup so capital is reserved atomically for all legs.
   */
  private _onStrategySignal(event: any): void {
    const signal = event.payload;
    if (!signal || signal.qty <= 0) return;

    let side: "buy" | "sell";
    if (signal.direction === "long" || signal.direction === "close_short") side = "buy";
    else if (signal.direction === "short" || signal.direction === "close_long") side = "sell";
    else return;

    const groupId = newId();
    const intents: import("../../types/orders").OrderIntent[] = [];

    // Primary intent
    const primaryIntent: import("../../types/orders").OrderIntent = {
      id: newId(),
      strategyId: signal.strategyId,
      symbol: signal.symbol,
      side,
      qty: signal.qty,
      orderType: "market" as const,
      timeInForce: "ioc" as const,
      reason: signal.triggerLabel,
      ts: nowMs(),
      meta: { ...signal.meta, groupId },
    };
    intents.push(primaryIntent);

    // Counterpart intent (for multi-leg signals like pairs trades)
    if (signal.meta && signal.meta.counterpartSymbol && signal.meta.counterpartDirection) {
      let cSide: "buy" | "sell";
      const cDir = signal.meta.counterpartDirection as string;
      if (cDir === "long" || cDir === "close_short") cSide = "buy";
      else if (cDir === "short" || cDir === "close_long") cSide = "sell";
      else {
        // Invalid counterpart direction — skip counterpart, submit primary only
        this._submitSingleIntent(primaryIntent, signal);
        return;
      }

      const cQty = Math.floor(signal.qty * ((signal.meta.hedgeRatio as number) || 1));
      if (cQty > 0) {
        const counterpartIntent: import("../../types/orders").OrderIntent = {
          id: newId(),
          strategyId: signal.strategyId,
          symbol: signal.meta.counterpartSymbol as string,
          side: cSide,
          qty: cQty,
          orderType: "market" as const,
          timeInForce: "ioc" as const,
          reason: (signal.triggerLabel || "") + "_counterpart",
          ts: nowMs(),
          meta: { ...signal.meta, groupId },
        };
        intents.push(counterpartIntent);
      }
    }

    // Compute priority from strategy type and signal confidence
    const priority = getSignalPriority(
      signal.strategyType ?? "momentum",
      signal.confidence,
      (signal.meta?.urgency as number) ?? undefined,
    );

    // Build signal group and submit to OMS
    const group: SignalGroup = {
      groupId,
      strategyId: signal.strategyId,
      strategyType: signal.strategyType ?? "momentum",
      intents,
      totalCapitalRequired: 0, // computed by OMS
      priority,
      confidence: signal.confidence,
      createdAt: nowMs(),
    };

    this.orderManager.submitSignalGroup(group);
  }

  /**
   * Shortcut: submit a single intent through the OMS when there's no
   * counterpart (single-leg signal).
   */
  private _submitSingleIntent(intent: import("../../types/orders").OrderIntent, signal: any): void {
    const priority = getSignalPriority(
      signal.strategyType ?? "momentum",
      signal.confidence,
    );

    const group: SignalGroup = {
      groupId: newId(),
      strategyId: signal.strategyId,
      strategyType: signal.strategyType ?? "momentum",
      intents: [intent],
      totalCapitalRequired: 0,
      priority,
      confidence: signal.confidence,
      createdAt: nowMs(),
    };

    this.orderManager.submitSignalGroup(group);
  }

  private _onOrderSubmitted(event: any): void {
    this.orderState.addOrder(event.payload);
  }

  private _onOrderPartialFill(event: OrderPartialFillEvent): void {
    this.orderState.applyFill(event.orderId, event.fill);
    this.portfolioState.applyFill(event.fill);
    this.eventBus.publish({
      id: newId(), type: "PORTFOLIO_UPDATED", ts: nowMs(), mode: this.mode,
      payload: this.portfolioState.getSnapshot(),
    });
  }

  private _onOrderFilled(event: OrderFilledEvent): void {
    // Guard: if partials already consumed the full qty, skip re-applying.
    const order = this.orderState.getOrder(event.orderId);
    if (order && order.status === "filled" && order.filledQty >= order.qty) {
      return;
    }
    this.orderState.applyFill(event.orderId, event.fill);
    this.portfolioState.applyFill(event.fill);

    // Release OMS capital reservation for the filled intent.
    this.orderManager.onOrderFilled(event.orderId);

    this.eventBus.publish({
      id: newId(), type: "PORTFOLIO_UPDATED", ts: nowMs(), mode: this.mode,
      payload: this.portfolioState.getSnapshot(),
    });
  }

  private _onOrderCanceled(event: OrderCanceledEvent): void {
    this.orderState.markCanceled(event.orderId);
    this.orderManager.onOrderCanceled(event.orderId);
  }

  private _onOrderRejected(event: OrderRejectedEvent): void {
    this.orderState.markRejected(event.orderId);
    this.orderManager.onOrderCanceled(event.orderId);
  }

  private _onOrderExpired(event: OrderExpiredEvent): void {
    this.orderState.markCanceled(event.orderId);
    this.orderManager.onOrderCanceled(event.orderId);
  }
}
