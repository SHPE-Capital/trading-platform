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
import { DirectExecutionAlgo } from "./algos/directExecution";
import type { IExecutionSink } from "./IExecutionSink";
import type { IExecutionAlgo } from "./algos/IExecutionAlgo";
import type { ExecutionAlgoType } from "../../types/common";
import type { OrderIntent, Order } from "../../types/orders";

// Re-export IExecutionSink so existing code importing it from executionEngine still works.
export type { IExecutionSink } from "./IExecutionSink";

export class ExecutionEngine {
  private readonly _algos: Map<ExecutionAlgoType, IExecutionAlgo>;

  /**
   * @param sink - Active execution sink (paper, live, or simulated)
   */
  constructor(private readonly sink: IExecutionSink) {
    this._algos = new Map<ExecutionAlgoType, IExecutionAlgo>([
      ["market", new DirectExecutionAlgo()],
      // TODO: Register TwapExecutionAlgo and VwapExecutionAlgo here when implemented.
      // ["twap", new TwapExecutionAlgo(parentChildTracker, capitalReservation)],
      // ["vwap", new VwapExecutionAlgo(parentChildTracker, capitalReservation, eventBus)],
    ]);
  }

  /**
   * Submits a validated order intent to the active execution algo, which routes
   * it to the execution sink. The algo is selected from intent.executionAlgo,
   * falling back to "market" (DirectExecutionAlgo) if not specified or unregistered.
   * @param intent - The validated OrderIntent to submit
   * @returns Promise resolving to the submitted Order
   */
  async submit(intent: OrderIntent): Promise<Order> {
    logger.info("ExecutionEngine: submitting order", {
      symbol: intent.symbol,
      side: intent.side,
      qty: intent.qty,
      type: intent.orderType,
      executionAlgo: intent.executionAlgo ?? "market",
    });
    const algo = this._algoRouter(intent.executionAlgo ?? "market");
    return algo.execute(intent, this.sink);
  }

  /**
   * Cancels an active order by its broker order ID.
   * @param brokerOrderId - Broker-assigned order ID
   */
  async cancel(brokerOrderId: string): Promise<void> {
    logger.info("ExecutionEngine: canceling order", { brokerOrderId });
    return this.sink.cancelOrder(brokerOrderId);
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  /**
   * Returns the registered IExecutionAlgo for the given type.
   * Falls back to the "market" (direct) algo if the type is not registered.
   * @param type - ExecutionAlgoType requested by the intent
   * @returns Registered IExecutionAlgo or DirectExecutionAlgo fallback
   */
  private _algoRouter(type: ExecutionAlgoType): IExecutionAlgo {
    return this._algos.get(type) ?? this._algos.get("market")!;
  }
}
