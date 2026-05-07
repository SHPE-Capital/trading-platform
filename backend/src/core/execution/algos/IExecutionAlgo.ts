/**
 * core/execution/algos/IExecutionAlgo.ts
 *
 * Contract for pluggable execution algorithms. The ExecutionEngine routes
 * approved OrderIntents through the appropriate IExecutionAlgo, which decides
 * HOW to submit the order to the sink (immediately, sliced over time, etc.).
 * This decouples order approval (OMS + risk) from order execution mechanics.
 *
 * Inputs:  Approved OrderIntent, active IExecutionSink.
 * Outputs: Submitted Order(s) via the sink, returned as Promise<Order>.
 */

import type { ExecutionAlgoType, UUID } from "../../../types/common";
import type { OrderIntent, Order } from "../../../types/orders";
import type { IExecutionSink } from "../IExecutionSink";

/** Contract for all execution algorithm implementations. */
export interface IExecutionAlgo {
  /** Algorithm type identifier — must match a registered ExecutionAlgoType */
  readonly type: ExecutionAlgoType;

  /**
   * Executes the approved order intent through the given sink.
   * The algorithm decides whether to submit immediately (market/direct),
   * slice over time (TWAP), or participate in volume (VWAP).
   * @param intent - Approved OrderIntent to execute
   * @param sink - Active IExecutionSink for order submission
   * @returns Promise resolving to the (first) submitted Order
   */
  execute(intent: OrderIntent, sink: IExecutionSink): Promise<Order>;

  /**
   * Cancels any pending slices, timers, or volume subscriptions for the intent.
   * No-op for algorithms that have no pending state (e.g. DirectExecutionAlgo).
   * @param intentId - UUID of the parent intent to cancel
   */
  cancel(intentId: UUID): Promise<void>;
}
