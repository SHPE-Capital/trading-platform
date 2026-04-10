/**
 * core/execution/executionEngine.ts
 *
 * Execution engine abstraction. Routes validated order intents to the
 * appropriate execution sink (paper/live Alpaca or simulated backtest).
 * The strategy and risk layers never interact with sinks directly.
 *
 * Inputs:  Validated OrderIntent from the Orchestrator (post-risk-check).
 * Outputs: Dispatches to the active IExecutionSink; publishes ORDER_SUBMITTED event.
 */

import { logger } from "../../utils/logger";
import type { OrderIntent, Order } from "../../types/orders";

/** Contract that every execution sink must implement */
export interface IExecutionSink {
  /** Submit an order to the execution provider */
  submitOrder(intent: OrderIntent): Promise<Order>;
  /** Cancel an order by broker order ID */
  cancelOrder(brokerOrderId: string): Promise<void>;
}

export class ExecutionEngine {
  constructor(private readonly sink: IExecutionSink) {}

  /**
   * Submits a validated order intent to the active execution sink.
   * @param intent - The validated OrderIntent to submit
   * @returns Promise resolving to the submitted Order
   */
  async submit(intent: OrderIntent): Promise<Order> {
    logger.info("ExecutionEngine: submitting order", {
      symbol: intent.symbol,
      side: intent.side,
      qty: intent.qty,
      type: intent.orderType,
    });
    return this.sink.submitOrder(intent);
  }

  /**
   * Cancels an active order by its broker order ID.
   * @param brokerOrderId - Broker-assigned order ID
   */
  async cancel(brokerOrderId: string): Promise<void> {
    logger.info("ExecutionEngine: canceling order", { brokerOrderId });
    return this.sink.cancelOrder(brokerOrderId);
  }
}
