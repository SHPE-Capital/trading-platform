/**
 * core/execution/simulatedExecution.ts
 *
 * Simulated execution sink for backtesting and replay modes.
 *
 * Behavior (backtest, bar-driven):
 *   - submitOrder() returns an unfilled Order (status="submitted", filledQty=0,
 *     fills=[]) and queues the intent. ORDER_FILLED is NOT emitted at submit time.
 *   - processBarOpen(bar) fills any queued intents for that symbol at the new
 *     bar's open price. This guarantees no same-bar lookahead: a strategy that
 *     submits on bar N's close can only see fills at bar N+1's open.
 *   - flushPending(symbol) fills queued intents at the latest mid price. Used
 *     for replay/quote-driven modes that don't emit bars.
 *   - If no usable reference price is available, the order is rejected via
 *     ORDER_REJECTED rather than filled at $0.
 *
 * Inputs:  OrderIntent from the ExecutionEngine; current symbol state for prices.
 * Outputs: Submitted Order; publishes ORDER_SUBMITTED + ORDER_FILLED/ORDER_REJECTED.
 */

import { EventBus } from "../engine/eventBus";
import { SymbolStateManager } from "../state/symbolState";
import { logger } from "../../utils/logger";
import { msToIso } from "../../utils/time";
import { newId } from "../../utils/ids";
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

  /**
   * @param eventBus - EventBus to publish fill events onto
   * @param symbolState - SymbolStateManager for current market prices
   * @param mode - Execution mode (backtest or replay)
   * @param slippageBps - Slippage in basis points applied to fill price
   * @param commissionPerShare - Commission per share (USD)
   */
  constructor(
    private readonly eventBus: EventBus,
    private readonly symbolState: SymbolStateManager,
    private readonly mode: ExecutionMode,
    private readonly slippageBps = 5,
    private readonly commissionPerShare = 0.005,
  ) {
    // Subscribe BEFORE the Orchestrator's BAR_RECEIVED handler so queued
    // intents fill at the new bar's open price prior to strategies seeing
    // the bar. EventBus dispatches handlers in registration order.
    this.eventBus.on("BAR_RECEIVED", (e) => {
      const ev = e as { payload: Bar };
      this.processBarOpen(ev.payload);
    });
  }

  /**
   * Submits an intent. The order is created in "submitted" state with zero
   * fills and queued for execution on the next bar's open (or via flushPending).
   * This is the no-lookahead path: a strategy reacting to bar N's close cannot
   * see a fill earlier than bar N+1's open.
   *
   * @param intent - OrderIntent to queue
   * @returns Promise resolving to the unfilled submitted Order
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
   * Drains all queued intents for the given symbol, filling each at the new
   * bar's open price. Called by the Orchestrator at the start of every bar,
   * BEFORE the bar updates symbol state or strategies evaluate. This guarantees
   * deterministic no-lookahead semantics for bar-backtests.
   *
   * @param bar - The new bar whose `open` is used as the fill reference price.
   */
  processBarOpen(bar: Bar): void {
    const queue = this.pending.get(bar.symbol);
    if (!queue || queue.length === 0) return;
    this.pending.set(bar.symbol, []);
    for (const { intent, order } of queue) {
      this._fillAt(intent, order, bar.open, bar.ts);
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
    const ts = symState?.latestQuote?.ts ?? symState?.latestTrade?.ts ?? symState?.latestBar?.ts ?? Date.now();
    for (const { intent, order } of queue) {
      this._fillAt(intent, order, refPrice, ts);
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
   * No-op for simulated execution — cancellation of queued intents is not
   * currently supported. Queued intents always fill on the next bar.
   * @param brokerOrderId - Simulated broker order ID (unused)
   */
  async cancelOrder(_brokerOrderId: string): Promise<void> {
    // Simulated fills are deterministic — nothing to cancel
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  private _fillAt(
    intent: OrderIntent,
    order: Order,
    refPrice: number | null | undefined,
    ts: number,
  ): void {
    if (refPrice == null || !Number.isFinite(refPrice) || refPrice <= 0) {
      // Fix #6: never fill at $0. Reject the order so portfolio/cash are not
      // corrupted by a phantom zero-price fill.
      order.status = "rejected";
      order.updatedAt = ts;
      order.closedAt = ts;
      logger.warn("SimulatedExecutionSink: rejecting order, no valid reference price", {
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

    const slippageFactor = this.slippageBps / 10_000;
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
      commission: intent.qty * this.commissionPerShare,
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
