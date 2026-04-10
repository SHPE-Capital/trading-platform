/**
 * core/state/orderState.ts
 *
 * In-memory order lifecycle state manager. Tracks all open and recently
 * closed orders. Does not write to DB — that is handled by repository calls
 * triggered from the Orchestrator or execution layer.
 *
 * Inputs:  Order submissions, fill events, cancel/reject events.
 * Outputs: Current order state queried by risk engine and frontend APIs.
 */

import { nowMs } from "../../utils/time";
import type { Order, Fill } from "../../types/orders";
import type { UUID, OrderStatus } from "../../types/common";

export class OrderStateManager {
  /** All orders indexed by internal order ID */
  private orders: Map<UUID, Order> = new Map();

  /**
   * Registers a newly submitted order.
   * @param order - The submitted Order object
   */
  addOrder(order: Order): void {
    this.orders.set(order.id, order);
  }

  /**
   * Returns an order by its internal ID, or null if not found.
   * @param orderId - Internal order ID
   * @returns Order or null
   */
  getOrder(orderId: UUID): Order | null {
    return this.orders.get(orderId) ?? null;
  }

  /**
   * Returns all currently tracked orders (open and recently closed).
   * @returns Array of Order objects
   */
  getAllOrders(): Order[] {
    return [...this.orders.values()];
  }

  /**
   * Returns all orders with status "submitted", "acknowledged", or "partial_fill".
   * These are the orders that are still active in the market.
   * @returns Array of open Order objects
   */
  getOpenOrders(): Order[] {
    const openStatuses: OrderStatus[] = ["submitted", "acknowledged", "partial_fill"];
    return [...this.orders.values()].filter((o) => openStatuses.includes(o.status));
  }

  /**
   * Returns all open orders for a specific strategy.
   * @param strategyId - Strategy ID to filter by
   * @returns Array of open Order objects for the strategy
   */
  getOpenOrdersByStrategy(strategyId: string): Order[] {
    return this.getOpenOrders().filter((o) => o.strategyId === strategyId);
  }

  /**
   * Applies a broker acknowledgment to an order (sets brokerOrderId, status).
   * @param orderId - Internal order ID
   * @param brokerOrderId - Broker-assigned order ID
   */
  markAcknowledged(orderId: UUID, brokerOrderId: string): void {
    const order = this.orders.get(orderId);
    if (!order) return;
    order.brokerOrderId = brokerOrderId;
    order.status = "acknowledged";
    order.updatedAt = nowMs();
  }

  /**
   * Applies a fill to an order, updating qty and average fill price.
   * Sets status to "partial_fill" or "filled" depending on remaining qty.
   * @param orderId - Internal order ID
   * @param fill - Fill to apply
   */
  applyFill(orderId: UUID, fill: Fill): void {
    const order = this.orders.get(orderId);
    if (!order) return;

    order.fills.push(fill);
    order.filledQty += fill.qty;

    // Recalculate weighted average fill price
    const totalNotional = order.fills.reduce((sum, f) => sum + f.qty * f.price, 0);
    order.avgFillPrice = totalNotional / order.filledQty;

    if (order.filledQty >= order.qty) {
      order.status = "filled";
      order.closedAt = fill.ts;
    } else {
      order.status = "partial_fill";
    }

    order.updatedAt = fill.ts;
  }

  /**
   * Marks an order as canceled.
   * @param orderId - Internal order ID
   */
  markCanceled(orderId: UUID): void {
    const order = this.orders.get(orderId);
    if (!order) return;
    order.status = "canceled";
    order.closedAt = nowMs();
    order.updatedAt = nowMs();
  }

  /**
   * Marks an order as rejected.
   * @param orderId - Internal order ID
   */
  markRejected(orderId: UUID): void {
    const order = this.orders.get(orderId);
    if (!order) return;
    order.status = "rejected";
    order.closedAt = nowMs();
    order.updatedAt = nowMs();
  }

  /**
   * Removes orders that are closed and older than the retention window.
   * Call periodically to prevent unbounded memory growth.
   * @param retentionMs - How long to retain closed orders (default 1 hour)
   */
  pruneClosedOrders(retentionMs = 3_600_000): void {
    const cutoff = nowMs() - retentionMs;
    for (const [id, order] of this.orders) {
      if (order.closedAt && order.closedAt < cutoff) {
        this.orders.delete(id);
      }
    }
  }

  /** Clears all order state. Used in tests and resets. */
  clear(): void {
    this.orders.clear();
  }
}
