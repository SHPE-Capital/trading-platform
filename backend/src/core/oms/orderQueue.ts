/**
 * core/oms/orderQueue.ts
 *
 * Priority queue for pending OrderIntents. Higher priority values are
 * dequeued first. Within equal priority, FIFO ordering is preserved via
 * the enqueuedAt timestamp. Backed by a sorted array for simplicity;
 * suitable for the expected order rate of a single-broker algo strategy.
 *
 * Inputs:  OrderIntents with caller-assigned priority values.
 * Outputs: Ordered stream of QueuedOrderIntents via dequeue().
 */

import { nowMs } from "../../utils/time";
import { logger } from "../../utils/logger";
import type { QueuedOrderIntent } from "../../types/oms";
import type { OrderIntent } from "../../types/orders";

export class OrderIntentQueue {
  private _queue: QueuedOrderIntent[] = [];

  /**
   * Adds an order intent to the queue at the given priority level.
   * The queue is re-sorted after each enqueue to maintain ordering.
   * @param intent - OrderIntent to enqueue
   * @param priority - Queue priority (higher = dequeued sooner)
   */
  enqueue(intent: OrderIntent, priority: number): void {
    const item: QueuedOrderIntent = {
      intent,
      priority,
      enqueuedAt: nowMs(),
    };

    this._queue.push(item);

    // Sort descending by priority, then ascending by enqueuedAt (FIFO on tie)
    this._queue.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.enqueuedAt - b.enqueuedAt;
    });

    logger.info("OrderIntentQueue: enqueued intent", {
      intentId: intent.id,
      strategyId: intent.strategyId,
      symbol: intent.symbol,
      priority,
      queueDepth: this._queue.length,
    });
  }

  /**
   * Removes and returns the highest-priority intent from the queue.
   * Returns null if the queue is empty.
   * @returns The next QueuedOrderIntent, or null
   */
  dequeue(): QueuedOrderIntent | null {
    return this._queue.shift() ?? null;
  }

  /**
   * Returns the next intent without removing it from the queue.
   * Returns null if the queue is empty.
   * @returns The next QueuedOrderIntent, or null
   */
  peek(): QueuedOrderIntent | null {
    return this._queue[0] ?? null;
  }

  /**
   * Returns the current number of intents waiting in the queue.
   * @returns Queue depth
   */
  size(): number {
    return this._queue.length;
  }

  /**
   * Removes all pending intents from the queue.
   * Used on engine stop or kill switch activation.
   */
  clear(): void {
    const count = this._queue.length;
    this._queue = [];
    logger.info("OrderIntentQueue: cleared queue", { count });
  }
}
