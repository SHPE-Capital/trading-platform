/**
 * core/execution/simulatedExecution.ts
 *
 * Simulated execution sink for backtesting and replay modes.
 * Immediately generates synthetic fills based on the last known market price,
 * applying configurable slippage and commission. Publishes fill events to
 * the EventBus so the same portfolio/order state pipeline is used.
 *
 * Inputs:  OrderIntent from the ExecutionEngine; current symbol state for prices.
 * Outputs: Synthetic Order and Fill; publishes ORDER_SUBMITTED + ORDER_FILLED events.
 */

import { EventBus } from "../engine/eventBus";
import { SymbolStateManager } from "../state/symbolState";
import { nowMs, msToIso } from "../../utils/time";
import { newId } from "../../utils/ids";
import type { IExecutionSink } from "./executionEngine";
import type { OrderIntent, Order, Fill } from "../../types/orders";
import type { ExecutionMode } from "../../types/common";

export class SimulatedExecutionSink implements IExecutionSink {
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
  ) {}

  /**
   * Simulates an immediate fill for the given order intent.
   * Fill price = last mid price ± slippage.
   * Publishes ORDER_SUBMITTED and ORDER_FILLED events.
   * @param intent - OrderIntent to fill
   * @returns Promise resolving to the simulated Order
   */
  async submitOrder(intent: OrderIntent): Promise<Order> {
    const ts = nowMs();
    const symState = this.symbolState.get(intent.symbol);
    const basePrice = symState?.latestMid ?? intent.limitPrice ?? 0;

    // Apply slippage: buys pay more, sells receive less
    const slippageFactor = this.slippageBps / 10_000;
    const fillPrice =
      intent.side === "buy"
        ? basePrice * (1 + slippageFactor)
        : basePrice * (1 - slippageFactor);

    const order: Order = {
      id: intent.id,
      brokerOrderId: `sim_${intent.id}`,
      intentId: intent.id,
      strategyId: intent.strategyId,
      symbol: intent.symbol,
      side: intent.side,
      qty: intent.qty,
      filledQty: intent.qty,
      avgFillPrice: fillPrice,
      orderType: intent.orderType,
      limitPrice: intent.limitPrice,
      stopPrice: intent.stopPrice,
      timeInForce: intent.timeInForce,
      status: "filled",
      submittedAt: ts,
      updatedAt: ts,
      closedAt: ts,
      fills: [],
    };

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

    order.fills = [fill];

    // Publish submission then fill
    this.eventBus.publish({
      id: newId(),
      type: "ORDER_SUBMITTED",
      ts,
      mode: this.mode,
      payload: order,
    });

    this.eventBus.publish({
      id: newId(),
      type: "ORDER_FILLED",
      ts,
      mode: this.mode,
      orderId: order.id,
      fill,
    });

    return order;
  }

  /**
   * No-op for simulated execution — simulated orders fill immediately
   * and cannot be canceled after submission.
   * @param brokerOrderId - Simulated broker order ID (unused)
   */
  async cancelOrder(_brokerOrderId: string): Promise<void> {
    // Simulated fills are immediate — nothing to cancel
  }
}
