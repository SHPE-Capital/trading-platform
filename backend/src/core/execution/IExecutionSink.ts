/**
 * core/execution/IExecutionSink.ts
 *
 * Contract for execution sinks. A sink is the terminal handler that submits
 * orders to the market or a simulation. Extracted from executionEngine.ts to
 * avoid a circular dependency with the execution algo layer.
 *
 * Inputs:  OrderIntent from the execution algo layer.
 * Outputs: Submitted Order (async, from broker or simulation).
 */

import type { OrderIntent, Order } from "@/types/orders";

/** Contract that every execution sink must implement. */
export interface IExecutionSink {
  /**
   * Submit an order to the execution provider.
   * @param intent - The validated OrderIntent to submit
   * @returns Promise resolving to the submitted Order
   */
  submitOrder(intent: OrderIntent): Promise<Order>;

  /**
   * Cancel an active order by its broker-assigned ID.
   * @param brokerOrderId - Broker-assigned order ID
   */
  cancelOrder(brokerOrderId: string): Promise<void>;
}
