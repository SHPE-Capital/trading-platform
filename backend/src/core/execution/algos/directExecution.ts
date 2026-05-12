/**
 * core/execution/algos/directExecution.ts
 *
 * Direct market execution algorithm. Submits the order intent to the sink
 * immediately without any slicing, scheduling, or participation logic.
 * This is the default execution path — the refactored behavior from
 * ExecutionEngine.submit() prior to the algo routing layer.
 *
 * Inputs:  Approved OrderIntent, active IExecutionSink.
 * Outputs: Single Order submitted immediately to the sink.
 */

import { logger } from "../../../utils/logger";
import type { ExecutionAlgoType, UUID } from "../../../types/common";
import type { OrderIntent, Order } from "../../../types/orders";
import type { IExecutionSink } from "../IExecutionSink";
import type { IExecutionAlgo } from "./IExecutionAlgo";

export class DirectExecutionAlgo implements IExecutionAlgo {
  readonly type: ExecutionAlgoType = "market";

  /**
   * Submits the order intent directly to the execution sink with no slicing.
   * @param intent - Approved OrderIntent
   * @param sink - Active IExecutionSink
   * @returns Promise resolving to the submitted Order
   */
  async execute(intent: OrderIntent, sink: IExecutionSink): Promise<Order> {
    logger.info("DirectExecutionAlgo: submitting order", {
      symbol: intent.symbol,
      side: intent.side,
      qty: intent.qty,
      type: intent.orderType,
    });
    return sink.submitOrder(intent);
  }

  /**
   * No-op — direct execution submits immediately with no pending state to cancel.
   * @param _intentId - Unused
   */
  async cancel(_intentId: UUID): Promise<void> {
    // Direct execution is fire-and-forget; nothing to cancel here.
  }
}
