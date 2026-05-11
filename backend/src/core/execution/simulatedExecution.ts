/**
 * core/execution/simulatedExecution.ts
 *
 * Simulated execution sink for backtesting and replay modes.
 *
 * Behavior (backtest, bar-driven):
 *   - submitOrder() returns an unfilled Order (status="submitted", filledQty=0,
 *     fills=[]) and queues the intent. ORDER_FILLED is NOT emitted at submit time.
 *   - processBarOpen(bar) fills any queued intents for that symbol against the
 *     bar using the configured FillModel. This guarantees no same-bar lookahead:
 *     a strategy that submits on bar N's close can only see fills at bar N+1.
 *   - flushPending(symbol) fills queued intents at the latest mid price. Used
 *     for replay/quote-driven modes that don't emit bars.
 *   - cancelOrder() can target either a queued intent (cancels before fill) or
 *     a broker order id; broker-id cancellation is a no-op since simulated
 *     fills complete atomically once a bar arrives.
 *   - If no usable reference price is available, the order is rejected via
 *     ORDER_REJECTED rather than filled at $0.
 *
 * Inputs:  OrderIntent from the ExecutionEngine; current symbol state for prices.
 * Outputs: Submitted Order; publishes ORDER_SUBMITTED + ORDER_FILLED/ORDER_REJECTED.
 */

import { EventBus } from "../engine/eventBus";
import { SymbolStateManager } from "../state/symbolState";
import { logger } from "../../utils/logger";
import { msToIso, nowMs } from "../../utils/time";
import { newId } from "../../utils/ids";
import {
  DEFAULT_FILL_MODEL,
  evaluateFill,
  type FillModelConfig,
} from "./fillModel";
import type { IExecutionSink } from "./IExecutionSink";
import type { OrderIntent, Order, Fill } from "../../types/orders";
import type { ExecutionMode, Symbol } from "../../types/common";
import type { Bar } from "../../types/market";

interface QueuedIntent {
  intent: OrderIntent;
  order: Order;
}

export class SimulatedExecutionSink implements IExecutionSink {
  private readonly pending: Map<Symbol, QueuedIntent[]> = new Map();
  private readonly fillModel: FillModelConfig;

  /**
   * @param eventBus - EventBus to publish fill events onto
   * @param symbolState - SymbolStateManager for current market prices
   * @param mode - Execution mode (backtest or replay)
   * @param slippageBps - Legacy slippage (overridden by fillModel.slippageBps if provided)
   * @param commissionPerShare - Legacy commission (overridden by fillModel.commissionPerShare)
   * @param fillModel - Optional partial fill-model override
   */
  constructor(
    private readonly eventBus: EventBus,
    private readonly symbolState: SymbolStateManager,
    private readonly mode: ExecutionMode,
    slippageBps = 5,
    commissionPerShare = 0.005,
    fillModel?: Partial<FillModelConfig>,
  ) {
    // Legacy ctor compatibility: when no explicit fillModel override is
    // supplied, the sink behaves like the prior revision — no half-spread,
    // no volume cap, no partial fills. Callers that want the new modeling
    // depth must opt in by passing a fillModel argument (BacktestEngine does).
    const legacy = fillModel === undefined;
    this.fillModel = legacy
      ? {
          ...DEFAULT_FILL_MODEL,
          slippageBps,
          commissionPerShare,
          halfSpreadBps: 0,
          volumeParticipationCap: 1,
          allowPartialFills: false,
        }
      : {
          ...DEFAULT_FILL_MODEL,
          slippageBps,
          commissionPerShare,
          ...fillModel,
        };

    // Subscribe BEFORE the Orchestrator's BAR_RECEIVED handler so queued
    // intents fill at the new bar's open price prior to strategies seeing
    // the bar. EventBus dispatches handlers in registration order.
    this.eventBus.on("BAR_RECEIVED", (e) => {
      const ev = e as { payload: Bar };
      this.processBarOpen(ev.payload);
    });
  }

  /** Returns the effective fill model in use (after defaults + overrides). */
  getFillModel(): FillModelConfig {
    return { ...this.fillModel };
  }

  /**
   * Submits an intent. The order is created in "submitted" state with zero
   * fills and queued for execution on the next bar's open (or via flushPending).
   */
  async submitOrder(intent: OrderIntent): Promise<Order> {
    const ts = intent.ts;

    const order: Order = {
      id: intent.id,
      brokerOrderId: `sim_${intent.id}`,
      intentId: intent.id,
      strategyId: intent.strategyId,
      symbol: intent.symbol,
      side: intent.side,
      qty: intent.qty,
      filledQty: 0,
      avgFillPrice: undefined,
      orderType: intent.orderType,
      limitPrice: intent.limitPrice,
      stopPrice: intent.stopPrice,
      timeInForce: intent.timeInForce,
      status: "submitted",
      submittedAt: ts,
      updatedAt: ts,
      fills: [],
    };

    const list = this.pending.get(intent.symbol) ?? [];
    list.push({ intent, order });
    this.pending.set(intent.symbol, list);

    this.eventBus.publish({
      id: newId(),
      type: "ORDER_SUBMITTED",
      ts,
      mode: this.mode,
      payload: order,
    });

    return order;
  }

  /**
   * Drains all queued intents for the given symbol, filling each through the
   * fill model against the new bar.
   */
  processBarOpen(bar: Bar): void {
    const queue = this.pending.get(bar.symbol);
    if (!queue || queue.length === 0) return;
    this.pending.set(bar.symbol, []);
    for (const { intent, order } of queue) {
      this._fillWithModel(intent, order, bar);
    }
  }

  /**
   * Drains queued intents for the given symbol at the latest mid price. Used
   * by replay/quote-driven flows that don't emit bars. Returns the number of
   * orders processed.
   */
  flushPending(symbol: Symbol): number {
    const queue = this.pending.get(symbol);
    if (!queue || queue.length === 0) return 0;
    this.pending.set(symbol, []);
    const symState = this.symbolState.get(symbol);
    const refPrice = symState?.latestMid ?? null;
    const ts =
      symState?.latestQuote?.ts ??
      symState?.latestTrade?.ts ??
      symState?.latestBar?.ts ??
      nowMs();
    for (const { intent, order } of queue) {
      this._fillAtFlush(intent, order, refPrice, ts);
    }
    return queue.length;
  }

  /** Returns the count of queued intents (for diagnostics/tests). */
  pendingCount(symbol?: Symbol): number {
    if (symbol) return this.pending.get(symbol)?.length ?? 0;
    let total = 0;
    for (const q of this.pending.values()) total += q.length;
    return total;
  }

  /**
   * Cancels a queued simulated order. Accepts either the broker order id
   * (e.g. "sim_<intentId>") or the internal order id directly. If found,
   * publishes ORDER_CANCELED and removes the intent from the queue so it
   * will not fill on the next bar. Returns true if a queued order was found.
   */
  async cancelOrder(brokerOrderId: string): Promise<void> {
    const normalized = brokerOrderId.startsWith("sim_")
      ? brokerOrderId.slice(4)
      : brokerOrderId;

    for (const [symbol, queue] of this.pending) {
      const idx = queue.findIndex(
        (q) => q.order.id === normalized || q.order.brokerOrderId === brokerOrderId,
      );
      if (idx === -1) continue;
      const [{ order }] = queue.splice(idx, 1);
      this.pending.set(symbol, queue);
      this.eventBus.publish({
        id: newId(),
        type: "ORDER_CANCELED",
        ts: nowMs(),
        mode: this.mode,
        orderId: order.id,
        reason: "Canceled via SimulatedExecutionSink",
      });
      return;
    }
    // No-op if the order is not queued — it has already filled, expired, or
    // was rejected before this call.
  }

  /**
   * Terminal cleanup for any intents still queued at the end of a backtest.
   * Each pending intent is expired via ORDER_EXPIRED.
   *
   * @returns Number of intents expired.
   */
  expireAllPending(): number {
    let expired = 0;
    for (const [symbol, queue] of this.pending) {
      if (queue.length === 0) continue;
      for (const { order } of queue) {
        const ts = order.updatedAt;
        this.eventBus.publish({
          id: newId(),
          type: "ORDER_EXPIRED",
          ts,
          mode: this.mode,
          orderId: order.id,
        });
        expired++;
      }
      this.pending.set(symbol, []);
    }
    if (expired > 0) {
      logger.info("SimulatedExecutionSink: expired pending intents at terminal drain", { expired });
    }
    return expired;
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  /** Runs the configured fill model against a bar and emits fill/reject events. */
  private _fillWithModel(intent: OrderIntent, order: Order, bar: Bar): void {
    const decision = evaluateFill(intent, bar, this.fillModel);
    const ts = bar.ts;

    if (decision.outcome === "rejected" || decision.fillPrice === null) {
      order.status = "rejected";
      order.updatedAt = ts;
      order.closedAt = ts;
      logger.warn("SimulatedExecutionSink: order rejected by fill model", {
        symbol: intent.symbol,
        side: intent.side,
        qty: intent.qty,
        reason: decision.reason,
      });
      this.eventBus.publish({
        id: newId(),
        type: "ORDER_REJECTED",
        ts,
        mode: this.mode,
        orderId: order.id,
        reason: decision.reason ?? "Rejected by fill model",
      });
      return;
    }

    const fill: Fill = {
      id: newId(),
      orderId: intent.id,
      symbol: intent.symbol,
      side: intent.side,
      qty: decision.filledQty,
      price: decision.fillPrice,
      notional: decision.filledQty * decision.fillPrice,
      commission: decision.filledQty * this.fillModel.commissionPerShare,
      ts,
      isoTs: msToIso(ts),
    };

    if (decision.outcome === "partial") {
      this.eventBus.publish({
        id: newId(),
        type: "ORDER_PARTIAL_FILL",
        ts,
        mode: this.mode,
        orderId: order.id,
        fill,
        remainingQty: decision.remainingQty,
      });
      // IOC: the unfilled remainder cannot be requeued. Mark the order as
      // expired (the orchestrator will transition it to a terminal state).
      if (intent.timeInForce === "ioc" || intent.timeInForce === "fok") {
        this.eventBus.publish({
          id: newId(),
          type: "ORDER_EXPIRED",
          ts,
          mode: this.mode,
          orderId: order.id,
        });
      }
      return;
    }

    this.eventBus.publish({
      id: newId(),
      type: "ORDER_FILLED",
      ts,
      mode: this.mode,
      orderId: order.id,
      fill,
    });
  }

  /**
   * Legacy mid-based fill path used by `flushPending` (quote-driven flows).
   * Simpler than the bar fill model — no volume cap or spread synthesis since
   * the mid price already comes from a fresh quote.
   */
  private _fillAtFlush(
    intent: OrderIntent,
    order: Order,
    refPrice: number | null | undefined,
    ts: number,
  ): void {
    if (refPrice == null || !Number.isFinite(refPrice) || refPrice <= 0) {
      order.status = "rejected";
      order.updatedAt = ts;
      order.closedAt = ts;
      logger.warn("SimulatedExecutionSink: rejecting flush order, no valid reference price", {
        symbol: intent.symbol,
        side: intent.side,
        qty: intent.qty,
      });
      this.eventBus.publish({
        id: newId(),
        type: "ORDER_REJECTED",
        ts,
        mode: this.mode,
        orderId: order.id,
        reason: "No valid reference price available for simulated fill",
      });
      return;
    }
    const slippageFactor = this.fillModel.slippageBps / 10_000;
    const fillPrice =
      intent.side === "buy"
        ? refPrice * (1 + slippageFactor)
        : refPrice * (1 - slippageFactor);
    const fill: Fill = {
      id: newId(),
      orderId: intent.id,
      symbol: intent.symbol,
      side: intent.side,
      qty: intent.qty,
      price: fillPrice,
      notional: intent.qty * fillPrice,
      commission: intent.qty * this.fillModel.commissionPerShare,
      ts,
      isoTs: msToIso(ts),
    };
    this.eventBus.publish({
      id: newId(),
      type: "ORDER_FILLED",
      ts,
      mode: this.mode,
      orderId: order.id,
      fill,
    });
  }
}
