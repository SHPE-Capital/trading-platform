/**
 * core/engine/orchestrator.ts
 *
 * The main trading engine orchestrator. Wires together the EventBus,
 * SymbolStateManager, StrategyRunner, RiskEngine, ExecutionEngine, and
 * OrderManagerService (OMS).
 *
 * Signal routing is event-driven: STRATEGY_SIGNAL_CREATED → ORDER_INTENT_CREATED
 * → risk check + capital reservation + execution. The OMS (orderManager) is kept
 * as a public field for external callers that need direct queue access.
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
import { OrderManagerService } from "../oms/orderManager";
import { CapitalReservationManager } from "../oms/capitalReservation";
import { OrderIntentQueue } from "../oms/orderQueue";
import { logger } from "../../utils/logger";
import { nowMs } from "../../utils/time";
import { newId } from "../../utils/ids";
import type { IStrategy } from "../../strategies/base/strategy";
import type { ExecutionMode, UUID } from "../../types/common";
import type { BaseStrategyConfig } from "../../types/strategy";
import type {
  QuoteReceivedEvent,
  TradeReceivedEvent,
  BarReceivedEvent,
  OrderFilledEvent,
  OrderPartialFillEvent,
  OrderCanceledEvent,
  OrderRejectedEvent,
  OrderExpiredEvent,
  OrderIntentCreatedEvent,
} from "../../types/events";

export class Orchestrator {
  private strategies: Map<string, IStrategy> = new Map();
  private running = false;
  private readonly capitalReservation = new CapitalReservationManager();
  /** intentId → reservationId, for releasing on any terminal order event */
  private readonly _reservationByIntent = new Map<UUID, UUID>();

  /** The Order Management System — available for external callers that need direct queue access */
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
   * @param runId - Optional run ID to use as the map key instead of strategy.id.
   *   Pass the strategy_runs.id when registering via the HTTP API so that
   *   hasStrategy/deregisterStrategy can be called with the run ID from the URL.
   *   Startup-registered strategies (no runId) continue keying on strategy.id.
   */
  registerStrategy(strategy: IStrategy, runId?: string): void {
    const key = runId ?? strategy.id;
    this.strategies.set(key, strategy);

    const cfg = strategy.config as BaseStrategyConfig;
    if (cfg.riskBudget) {
      this.riskEngine.registerStrategyBudget({ ...cfg.riskBudget, strategyId: strategy.id });
    }

    logger.info("Orchestrator: strategy registered", {
      strategyId: strategy.id,
      key,
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

  /** Returns true if any registered strategy was launched from the given config ID. */
  hasStrategyWithConfigId(configId: string): boolean {
    for (const strategy of this.strategies.values()) {
      if (strategy.config.id === configId) return true;
    }
    return false;
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

    // Signals → intents → risk + reservation + execution
    this.eventBus.on("STRATEGY_SIGNAL_CREATED", (e) => this._onStrategySignal(e as any));
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
   * Stops the orchestrator, all registered strategies, and the OMS.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    this.orderManager.clear();

    for (const strategy of this.strategies.values()) {
      strategy.stop();
      this.eventBus.publish({
        id: newId(), type: "STRATEGY_STOPPED", ts: nowMs(), mode: this.mode,
        strategyId: strategy.id,
      });
    }

    this.capitalReservation.clear();
    this._reservationByIntent.clear();

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
    // Mark-to-market against the bar close so the equity snapshot taken right
    // after this handler returns reflects the current price.
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
   * Converts emitted StrategySignals into ORDER_INTENT_CREATED events.
   *
   * Two-sided market-making signals (signal.meta.kind === "maker_quotes")
   * are handled separately: one limit intent per leg of meta.makerQuotes.
   * This keeps existing single-direction strategies untouched while
   * letting market makers post a bid and ask in a single dispatch.
   */
  private _onStrategySignal(event: any): void {
    const signal = event.payload;
    if (!signal) return;

    // Maker-quote signals (e.g. Avellaneda-Stoikov): emit one limit intent
    // per leg of meta.makerQuotes. Top-level qty/direction are ignored.
    if (signal.meta && signal.meta.kind === "maker_quotes") {
      this._onMakerQuoteSignal(signal, event.mode);
      return;
    }

    if (signal.qty <= 0) return;

    let side: "buy" | "sell";
    if (signal.direction === "long" || signal.direction === "close_short") side = "buy";
    else if (signal.direction === "short" || signal.direction === "close_long") side = "sell";
    else return;

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
      meta: signal.meta,
    };

    // Fix #8: compute counterpart FIRST. If counterpart qty rounds to zero, drop
    // BOTH legs — otherwise we'd execute a naked leg that no longer hedges anything.
    let cIntent: import("../../types/orders").OrderIntent | null = null;
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
          meta: signal.meta,
        };
      }
    }

    this.eventBus.publish({
      id: newId(),
      type: "ORDER_INTENT_CREATED",
      ts: nowMs(),
      mode: event.mode,
      strategyId: signal.strategyId,
      payload: primaryIntent,
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

  /**
   * Routes a maker-quote signal (meta.kind === "maker_quotes") by emitting
   * one ORDER_INTENT_CREATED event per leg of meta.makerQuotes. Each leg
   * becomes a LIMIT order with the per-leg side/price/qty; the requested
   * timeInForce from meta is honored (defaulting to "day" for resting orders).
   *
   * No-op when makerQuotes is empty (e.g. kill-switch state).
   */
  private _onMakerQuoteSignal(signal: any, mode: ExecutionMode): void {
    const meta = signal.meta as {
      kind: "maker_quotes";
      makerQuotes?: Array<{ side: "buy" | "sell"; price: number; qty: number }>;
      timeInForce?: "day" | "gtc" | "ioc";
    };
    const quotes = meta.makerQuotes ?? [];
    if (quotes.length === 0) return;

    const tif = meta.timeInForce ?? "day";
    for (const q of quotes) {
      if (!q || q.qty <= 0 || !Number.isFinite(q.price) || q.price <= 0) continue;
      const intent = {
        id: newId(),
        strategyId: signal.strategyId,
        symbol: signal.symbol,
        side: q.side,
        qty: q.qty,
        orderType: "limit" as const,
        limitPrice: q.price,
        timeInForce: tif,
        reason: signal.triggerLabel,
        ts: nowMs(),
      };
      this.eventBus.publish({
        id: newId(),
        type: "ORDER_INTENT_CREATED",
        ts: nowMs(),
        mode,
        strategyId: signal.strategyId,
        payload: intent,
      });
    }
  }

  /**
   * Processes a single ORDER_INTENT_CREATED event through the full pre-trade
   * pipeline: risk check → worst-case price estimation → strategy budget check
   * → capital reservation → execution submission.
   */
  private _onOrderIntent(event: OrderIntentCreatedEvent): void {
    const intent = event.payload;
    const symState = this.symbolState.get(intent.symbol);
    const mid = symState?.latestMid ?? symState?.latestBar?.close ?? null;
    const portfolio = this.portfolioState.getSnapshot();

    // Stage 1: signal-time risk checks (kill switch, cooldown, position/cash/concentration)
    const riskResult = this.riskEngine.check(intent, portfolio, mid ?? undefined);
    if (!riskResult.passed) {
      this.eventBus.publish({
        id: newId(), type: "RISK_REJECTED", ts: nowMs(), mode: this.mode,
        strategyId: event.strategyId,
        reason: riskResult.reason ?? "Risk check failed",
        rejectedIntent: intent,
      });
      return;
    }

    // Worst-case fill price: limit orders use limitPrice; market orders apply gap+spread+slippage buffer
    const worstCasePrice = this.riskEngine.estimateWorstCasePrice(intent.side, intent, mid);
    if (worstCasePrice === null) {
      this.eventBus.publish({
        id: newId(), type: "RISK_REJECTED", ts: nowMs(), mode: this.mode,
        strategyId: event.strategyId,
        reason: "No reference price available for worst-case estimate",
        rejectedIntent: intent,
      });
      return;
    }
    const worstCaseNotional = intent.qty * worstCasePrice;

    // Per-strategy budget check (skipped when no budget is registered for this strategy)
    const alreadyReserved = this.capitalReservation.getStrategyReservedAmount(intent.strategyId);
    const openOrderCount = this.capitalReservation.getOpenOrderCount(intent.strategyId);
    const budgetFail = this.riskEngine.checkStrategyBudget(intent, worstCaseNotional, portfolio, alreadyReserved, openOrderCount);
    if (budgetFail) {
      this.eventBus.publish({
        id: newId(), type: "RISK_REJECTED", ts: nowMs(), mode: this.mode,
        strategyId: event.strategyId,
        reason: budgetFail.reason,
        rejectedIntent: intent,
      });
      return;
    }

    // Capital reservation — prevents double-spending across concurrent pending orders
    const reservation = this.capitalReservation.reserve(intent, worstCaseNotional, portfolio.cash);
    if (!reservation) {
      this.eventBus.publish({
        id: newId(), type: "CAPITAL_UNAVAILABLE", ts: nowMs(), mode: this.mode,
        intentId: intent.id,
        strategyId: intent.strategyId,
        required: worstCaseNotional,
        available: this.capitalReservation.getAvailableCash(portfolio.cash),
      });
      return;
    }

    this._reservationByIntent.set(intent.id, reservation.reservationId);
    this.eventBus.publish({
      id: newId(), type: "CAPITAL_RESERVED", ts: nowMs(), mode: this.mode,
      reservationId: reservation.reservationId,
      amount: reservation.amount,
      intentId: intent.id,
      strategyId: intent.strategyId,
    });

    this.executionEngine.submit(intent).catch((err) => {
      logger.error("Orchestrator: execution submission failed", {
        intentId: intent.id,
        error: String(err),
      });
      this._releaseReservation(intent.id, "rejected");
    });
  }

  private _releaseReservation(intentId: UUID, reason: "filled" | "canceled" | "rejected"): void {
    const reservationId = this._reservationByIntent.get(intentId);
    if (!reservationId) return;
    this._reservationByIntent.delete(intentId);
    this.capitalReservation.release(reservationId);
    this.eventBus.publish({
      id: newId(), type: "CAPITAL_RELEASED", ts: nowMs(), mode: this.mode,
      reservationId,
      reason,
    });
  }

  private _onOrderSubmitted(event: any): void {
    this.orderState.addOrder(event.payload);
  }

  /**
   * Handles partial fill events. Applies the delta fill to both order and
   * portfolio state incrementally and adjusts the capital reservation down
   * proportionally so already-deployed capital is freed for subsequent orders.
   */
  private _onOrderPartialFill(event: OrderPartialFillEvent): void {
    // Scale down the capital reservation proportionally to the remaining unfilled
    // qty. Must run before orderState.applyFill so filledQty still reflects the
    // pre-fill cumulative, letting us compute the correct remaining fraction.
    const reservationId = this._reservationByIntent.get(event.orderId);
    if (reservationId) {
      const order = this.orderState.getOrder(event.orderId);
      const reservation = this.capitalReservation.getReservation(reservationId);
      if (order && reservation && reservation.amount > 0 && order.qty > 0) {
        const currentOpenQty = order.qty - order.filledQty;
        const remainingQty = Math.max(0, currentOpenQty - event.fill.qty);
        const newAmount = currentOpenQty > 0
          ? reservation.amount * remainingQty / currentOpenQty
          : 0;
        this.capitalReservation.adjustAmount(reservationId, newAmount);
      }
    }

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

    this._releaseReservation(event.orderId, "filled");
    this.orderState.applyFill(event.orderId, event.fill);
    this.portfolioState.applyFill(event.fill);

    const snapshot = this.portfolioState.getSnapshot();
    this.eventBus.publish({
      id: newId(), type: "PORTFOLIO_UPDATED", ts: nowMs(), mode: this.mode,
      payload: snapshot,
    });

    const violation = this.riskEngine.checkPortfolio(snapshot);
    if (violation) {
      if (violation.engageKillSwitch) this.riskEngine.setKillSwitch(true);
      this.eventBus.publish({
        id: newId(), type: "PORTFOLIO_RISK_VIOLATION", ts: nowMs(), mode: this.mode,
        check: violation.check,
        reason: violation.reason,
        engageKillSwitch: violation.engageKillSwitch,
        grossExposurePct: violation.grossExposurePct,
        netExposurePct: violation.netExposurePct,
      });
    }
  }

  private _onOrderCanceled(event: OrderCanceledEvent): void {
    this._releaseReservation(event.orderId, "canceled");
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
    this._releaseReservation(event.orderId, "rejected");
    this.orderState.markRejected(event.orderId);
  }

  /**
   * Handles broker-side expiration (e.g. IOC orders that didn't fill in time).
   * Equivalent terminal transition to cancellation from the orchestrator's
   * perspective — no portfolio change.
   */
  private _onOrderExpired(event: OrderExpiredEvent): void {
    this._releaseReservation(event.orderId, "canceled");
    this.orderState.markCanceled(event.orderId);
  }
}
