/**
 * core/execution/journaledExecution.ts
 *
 * Writes every order to the ledger before it is sent. Without this, a crash
 * between the broker accepting an order and our insert left an order at the
 * broker that the platform never heard of — no run, no attribution.
 *
 * Fails closed: if the ledger cannot record the order, the order is not sent.
 * A database outage therefore pauses trading rather than letting it continue
 * unrecorded. A send that fails after the row exists marks the row rejected.
 */

import type { IExecutionSink } from "./IExecutionSink";
import type { Order, OrderIntent } from "../../types/orders";
import type { UUID } from "../../types/common";

export interface OrderJournal {
  /** Records the order as pending. Must throw if it could not. */
  recordPending(intent: OrderIntent): Promise<void>;
  /** The send failed; the order never reached the broker. */
  recordSendFailed(intentId: UUID, reason: string): Promise<void>;
}

export class JournalUnavailableError extends Error {
  constructor(readonly intentId: UUID, cause: unknown) {
    super(`Order ${intentId} not sent: the ledger could not record it (${cause instanceof Error ? cause.message : String(cause)})`);
    this.name = "JournalUnavailableError";
  }
}

export class JournaledExecutionSink implements IExecutionSink {
  constructor(
    private readonly inner: IExecutionSink,
    private readonly journal: OrderJournal,
    /** Told about each order refused because the journal failed. */
    private readonly onJournalFailure?: (intent: OrderIntent, err: JournalUnavailableError) => void,
  ) {}

  async submitOrder(intent: OrderIntent): Promise<Order> {
    try {
      await this.journal.recordPending(intent);
    } catch (cause) {
      const err = new JournalUnavailableError(intent.id, cause);
      this.onJournalFailure?.(intent, err);
      throw err;
    }
    try {
      return await this.inner.submitOrder(intent);
    } catch (err) {
      await this.journal.recordSendFailed(intent.id, err instanceof Error ? err.message : String(err)).catch(() => {});
      throw err;
    }
  }

  cancelOrder(brokerOrderId: string): Promise<void> {
    return this.inner.cancelOrder(brokerOrderId);
  }
}
