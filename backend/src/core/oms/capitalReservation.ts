/**
 * core/oms/capitalReservation.ts
 *
 * Manages capital pre-reservation for pending order intents. Ensures that
 * the sum of all reserved amounts never exceeds available cash, preventing
 * multiple concurrent strategies from over-committing capital before orders
 * are filled or rejected.
 *
 * Inputs:  OrderIntent (to compute reservation amount), total available cash.
 * Outputs: Reservation receipts, reserved total, available cash after reservations.
 */

import { newId } from "../../utils/ids";
import { nowMs } from "../../utils/time";
import { logger } from "../../utils/logger";
import type { UUID } from "../../types/common";
import type { CapitalReservation } from "../../types/oms";
import type { OrderIntent } from "../../types/orders";

export class CapitalReservationManager {
  private readonly _reservations: Map<UUID, CapitalReservation> = new Map();

  /**
   * Attempts to reserve capital for a pending order intent.
   * Returns null if estimated cost is zero or exceeds available cash.
   * @param intent - OrderIntent to reserve capital for
   * @param totalCash - Current total cash balance (before reservations)
   * @returns Reservation receipt, or null if insufficient capital
   */
  reserve(
    intent: OrderIntent,
    totalCash: number,
  ): { reservationId: UUID; amount: number } | null {
    const amount = intent.qty * (intent.limitPrice ?? 0);

    if (amount <= 0) {
      logger.warn("CapitalReservationManager: cannot reserve — amount is zero or negative", {
        intentId: intent.id,
        qty: intent.qty,
        limitPrice: intent.limitPrice,
      });
      return null;
    }

    const available = this.getAvailableCash(totalCash);
    if (amount > available) {
      logger.info("CapitalReservationManager: insufficient capital to reserve", {
        intentId: intent.id,
        required: amount,
        available,
        alreadyReserved: this.getReservedTotal(),
      });
      return null;
    }

    const reservationId = newId();
    const reservation: CapitalReservation = {
      reservationId,
      amount,
      strategyId: intent.strategyId,
      intentId: intent.id,
      ts: nowMs(),
    };

    this._reservations.set(reservationId, reservation);
    logger.info("CapitalReservationManager: reserved capital", {
      reservationId,
      amount,
      intentId: intent.id,
      strategyId: intent.strategyId,
      totalReserved: this.getReservedTotal(),
    });

    return { reservationId, amount };
  }

  /**
   * Releases a capital reservation after an order is filled, canceled, or rejected.
   * @param reservationId - ID of the reservation to release
   */
  release(reservationId: UUID): void {
    const reservation = this._reservations.get(reservationId);
    if (!reservation) {
      logger.warn("CapitalReservationManager: release called for unknown reservationId", {
        reservationId,
      });
      return;
    }
    this._reservations.delete(reservationId);
    logger.info("CapitalReservationManager: released reservation", {
      reservationId,
      amount: reservation.amount,
      intentId: reservation.intentId,
      totalReserved: this.getReservedTotal(),
    });
  }

  /**
   * Returns the total USD amount currently reserved across all pending intents.
   * @returns Sum of all active reservation amounts
   */
  getReservedTotal(): number {
    let total = 0;
    for (const r of this._reservations.values()) {
      total += r.amount;
    }
    return total;
  }

  /**
   * Returns available cash after subtracting all active reservations.
   * @param totalCash - Current total cash balance
   * @returns Cash available for new orders
   */
  getAvailableCash(totalCash: number): number {
    return totalCash - this.getReservedTotal();
  }

  /**
   * Clears all active reservations. Used on engine stop or kill switch activation.
   */
  clear(): void {
    const count = this._reservations.size;
    this._reservations.clear();
    logger.info("CapitalReservationManager: cleared all reservations", { count });
  }
}
