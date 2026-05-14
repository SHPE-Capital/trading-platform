/**
 * core/execution/liveExecution.ts
 *
 * Live trading execution sink. Delegates order submission and cancellation
 * to the AlpacaOrderExecutionAdapter pointed at the live trading endpoint.
 * Implements IExecutionSink so it can be injected into the ExecutionEngine.
 *
 * Every submitOrder call emits a logger.warn so that real-money order
 * submissions are always visible at warn level — never silently buried in
 * info logs. The adapter passed to this sink must be constructed with
 * mode: "live"; the sink itself does not enforce or inspect the mode.
 */

import { logger } from "../../utils/logger";
import type { IExecutionSink } from "./executionEngine";
import type { AlpacaOrderExecutionAdapter } from "../../adapters/alpaca/orderExecution";
import type { OrderIntent, Order } from "../../types/orders";

export class LiveExecutionSink implements IExecutionSink {
  constructor(private readonly adapter: AlpacaOrderExecutionAdapter) {}

  /** Logs a warning on every call — real money is at risk. */
  async submitOrder(intent: OrderIntent): Promise<Order> {
    logger.warn("LiveExecutionSink: submitting LIVE order — real money at risk", {
      symbol: intent.symbol,
      side: intent.side,
      qty: intent.qty,
      orderType: intent.orderType,
    });
    return this.adapter.submitOrder(intent);
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    return this.adapter.cancelOrder(brokerOrderId);
  }
}
