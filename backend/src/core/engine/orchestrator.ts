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
  OrderRejectedEvent,
  OrderPartialFillEvent,
  OrderExpiredEvent,
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

    // Listen to signals to generate intents
    this.eventBus.on("STRATEGY_SIGNAL_CREATED", (e) => this._onStrategySignal(e as any));

    // Wire order intent → risk → execution
    this.eventBus.on("ORDER_INTENT_CREATED", (e) => this._onOrderIntent(e as OrderIntentCreatedEvent));

    // Wire fills and state updates back into portfolio and order state
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
    // Mark-to-market: refresh unrealized PnL on every quote so equity tracks
    // price moves even when no new fills occur.
    this.portfolioState.updatePrice(event.payload.symbol, event.payload.midPrice);
    this._evaluateStrategies(event.payload.symbol);
  }

  private _onTrade(event: TradeReceivedEvent): void {
    this.symbolState.onTrade(event.payload);
    this.portfolioState.updatePrice(event.payload.symbol, event.payload.price);
    this._evaluateStrategies(event.payload.symbol);
  }

  private _onBar(event: BarReceivedEvent): void {
    this.symbolState.onBar(event.payload);
    // Mark-to-market against the bar close: this is what the equity snapshot
    // taken right after this handler returns will see.
    this.portfolioState.updatePrice(event.payload.symbol, event.payload.close);
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

    // TODO: Call positionSizer.computeQty() here when signal.qty should be overridden by
    // the sizing layer. Inject a Map<SizerType, IPositionSizer> into the Orchestrator
    // constructor alongside riskEngine and executionEngine. Use signal.meta or strategy
    // config's sizerType to select the sizer. estimatedPrice = symbolState mid ?? 0.
    // See core/sizing/IPositionSizer.ts and core/sizing/fixedNotionalSizer.ts.

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

    // Fix #8: when a pair/hedge signal includes a counterpart leg, compute the
    // counterpart's intent FIRST. If the counterpart rounds to zero qty, drop
    // the leg-1 intent too — otherwise we'd execute a naked leg that no longer
    // hedges anything (the original silent-drop bug).
    let cIntent: typeof intent | null = null;
    if (signal.meta && signal.meta.counterpartSymbol && signal.meta.counterpartDirection) {
      let cSide: "buy" | "sell" | null = null;
      const cDir = signal.meta.counterpartDirection as string;
      if (cDir === "long" || cDir === "close_short") cSide = "buy";
      else if (cDir === "short" || cDir === "close_long") cSide = "sell";

      if (cSide !== null) {
        const cQty = Math.floor(signal.qty * ((signal.meta.hedgeRatio as number) || 1));
        if (cQty <= 0) {
          logger.warn("Orchestrator: dropping pair signal — counterpart qty rounded to zero", {
            strategyId: signal.strategyId,
            symbol: signal.symbol,
            counterpart: signal.meta.counterpartSymbol,
            hedgeRatio: signal.meta.hedgeRatio,
          });
          return;
        }
        cIntent = {
          id: newId(),
          strategyId: signal.strategyId,
          symbol: signal.meta.counterpartSymbol as string,
          side: cSide,
          qty: cQty,
          orderType: "market" as const,
          timeInForce: "ioc" as const,
          reason: (signal.triggerLabel || "") + "_counterpart",
          ts: nowMs(),
        };
      }
    }

    this.eventBus.publish({
      id: newId(),
      type: "ORDER_INTENT_CREATED",
      ts: nowMs(),
      mode: event.mode,
      strategyId: signal.strategyId,
      payload: intent,
    });

    if (cIntent) {
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

  private _onOrderIntent(event: OrderIntentCreatedEvent): void {
    // TODO: Route through CapitalReservationManager.reserve() before risk check.
    // Compute estimatedCost = intent.qty * (intent.limitPrice ?? symbolState midprice).
    // If insufficient available cash: publish CAPITAL_UNAVAILABLE and return early.
    // Store reservationId on intent.meta for release on ORDER_FILLED or RISK_REJECTED.
    // See core/oms/capitalReservation.ts.

    // TODO: After risk passes, enqueue in OrderIntentQueue (core/oms/orderQueue.ts) rather
    // than submitting directly. A dequeue loop driven by a timer or drain event should pop
    // intents in priority order and call executionEngine.submit(), enabling rate-limiting
    // and priority-based conflict resolution without blocking the event handler.

    const symState = this.symbolState.get(event.payload.symbol);
    const referencePrice =
      symState?.latestMid ??
      symState?.latestTrade?.price ??
      symState?.latestBar?.close ??
      undefined;
    const riskResult = this.riskEngine.check(
      event.payload,
      this.portfolioState.getSnapshot(),
      referencePrice ?? undefined,
    );
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

  /**
   * Handles partial fill events. Applies the (delta) fill to both order and
   * portfolio state incrementally and emits PORTFOLIO_UPDATED so downstream
   * consumers (WS push, snapshot persister) see the change immediately.
   *
   * Convention: `event.fill.qty` is the delta qty for THIS partial fill, not
   * the cumulative. The terminal `ORDER_FILLED` event that follows also carries
   * a delta — see AlpacaOrderExecutionAdapter — so applying both does not
   * double-count. OrderStateManager.applyFill recomputes status from the running
   * cumulative filledQty and transitions to "filled" once it reaches order.qty.
   */
  private _onOrderPartialFill(event: OrderPartialFillEvent): void {
    this.orderState.applyFill(event.orderId, event.fill);
    this.portfolioState.applyFill(event.fill);
    this.eventBus.publish({
      id: newId(), type: "PORTFOLIO_UPDATED", ts: nowMs(), mode: this.mode,
      payload: this.portfolioState.getSnapshot(),
    });
  }

  private _onOrderFilled(event: OrderFilledEvent): void {
    // If an upstream sink already applied a partial-fill chain that consumed
    // the full order qty, skip re-applying — partials already covered it.
    // This guards adapters that emit BOTH cumulative partial events and a
    // final cumulative fill (rare but defensible: protocol bugs / replays).
    const order = this.orderState.getOrder(event.orderId);
    if (order && order.status === "filled" && order.filledQty >= order.qty) {
      return;
    }
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

  /**
   * Handles broker/sim rejection. Transitions the order to "rejected" so it
   * doesn't remain stuck as "submitted" in OrderStateManager — critical for
   * backtest accounting (e.g. SimulatedExecutionSink rejects orders that have
   * no usable reference price). No portfolio change: a rejection means no fill
   * occurred.
   */
  private _onOrderRejected(event: OrderRejectedEvent): void {
    this.orderState.markRejected(event.orderId);
  }

  /**
   * Handles broker-side expiration (e.g. IOC orders that didn't fill in time).
   * Equivalent terminal transition to cancellation from the orchestrator's
   * perspective — no portfolio change.
   */
  private _onOrderExpired(event: OrderExpiredEvent): void {
    this.orderState.markCanceled(event.orderId);
  }
}
