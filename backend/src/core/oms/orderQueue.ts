/**
 * core/oms/orderQueue.ts
 *
 * Priority queue for pending OrderIntents. Higher priority values are
 * dequeued first. Within equal priority, FIFO ordering is preserved via
 * the enqueuedAt timestamp. Backed by a sorted array for simplicity;
 * suitable for the expected order rate of a single-broker algo strategy.
 *
 * Supports removal by intent ID or group ID for cancellation and
 * conflict resolution.
 *
 * Inputs:  OrderIntents with caller-assigned priority values.
 * Outputs: Ordered stream of QueuedOrderIntents via dequeue().
 */

import { nowMs } from "../../utils/time";
import { logger } from "../../utils/logger";
import type { UUID } from "../../types/common";
import type { QueuedOrderIntent } from "../../types/oms";
import type { OrderIntent } from "../../types/orders";

export class OrderIntentQueue {
  private _queue: QueuedOrderIntent[] = [];

  /**
   * Adds an order intent to the queue at the given priority level.
   * The queue is re-sorted after each enqueue to maintain ordering.
   * @param intent - OrderIntent to enqueue
   * @param priority - Queue priority (higher = dequeued sooner)
   * @param groupId - Optional signal group ID for multi-leg tracking
   * @param reservationId - Optional capital reservation ID
   */
  enqueue(
    intent: OrderIntent,
    priority: number,
    groupId?: UUID,
    reservationId?: UUID,
  ): void {
    const item: QueuedOrderIntent = {
      intent,
      priority,
      enqueuedAt: nowMs(),
      reservationId,
      groupId,
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
      groupId,
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
   * Removes and returns all intents from the queue in priority order.
   * Used by the OMS drain loop to process all pending intents.
   * @returns Array of QueuedOrderIntents in priority order
   */
  drainAll(): QueuedOrderIntent[] {
    const items = [...this._queue];
    this._queue = [];
    logger.info("OrderIntentQueue: drained all intents", { count: items.length });
    return items;
  }

  /**
   * Removes a single intent by its ID. Used when an individual intent
   * is rejected or canceled.
   * @param intentId - ID of the intent to remove
   * @returns The removed QueuedOrderIntent, or null if not found
   */
  removeByIntentId(intentId: UUID): QueuedOrderIntent | null {
    const index = this._queue.findIndex((item) => item.intent.id === intentId);
    if (index === -1) return null;
    const [removed] = this._queue.splice(index, 1);
    logger.info("OrderIntentQueue: removed intent", {
      intentId,
      queueDepth: this._queue.length,
    });
    return removed;
  }

  /**
   * Removes all intents belonging to a specific signal group.
   * Used when a group reservation fails or the group is canceled.
   * @param groupId - Signal group ID
   * @returns Array of removed QueuedOrderIntents
   */
  removeByGroupId(groupId: UUID): QueuedOrderIntent[] {
    const removed: QueuedOrderIntent[] = [];
    this._queue = this._queue.filter((item) => {
      if (item.groupId === groupId) {
        removed.push(item);
        return false;
      }
      return true;
    });
    if (removed.length > 0) {
      logger.info("OrderIntentQueue: removed group", {
        groupId,
        removedCount: removed.length,
        queueDepth: this._queue.length,
      });
    }
    return removed;
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
