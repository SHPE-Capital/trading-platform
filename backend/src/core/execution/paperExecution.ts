/**
 * core/execution/paperExecution.ts
 *
 * Paper trading execution sink. Delegates order submission and cancellation
 * to the AlpacaOrderExecutionAdapter pointed at the paper trading endpoint.
 * Implements IExecutionSink so it can be injected into the ExecutionEngine.
 *
 * Inputs:  OrderIntent from the ExecutionEngine.
 * Outputs: Order submitted to Alpaca paper endpoint; events published via adapter.
 */

import type { IExecutionSink } from "./executionEngine";
import type { AlpacaOrderExecutionAdapter } from "../../adapters/alpaca/orderExecution";
import type { OrderIntent, Order } from "../../types/orders";

export class PaperExecutionSink implements IExecutionSink {
  /**
   * @param adapter - AlpacaOrderExecutionAdapter configured for paper mode
   */
  constructor(private readonly adapter: AlpacaOrderExecutionAdapter) {}

  /**
   * Submits an order to the Alpaca paper trading endpoint.
   * @param intent - Validated OrderIntent
   * @returns Promise resolving to the submitted Order
   */
  async submitOrder(intent: OrderIntent): Promise<Order> {
    return this.adapter.submitOrder(intent);
  }

  /**
   * Cancels an order via the Alpaca paper trading endpoint.
   * @param brokerOrderId - Alpaca order ID to cancel
   */
  async cancelOrder(brokerOrderId: string): Promise<void> {
    return this.adapter.cancelOrder(brokerOrderId);
  }
}
