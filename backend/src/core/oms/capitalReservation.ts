/**
 * core/oms/capitalReservation.ts
 *
 * Manages capital pre-reservation for pending order intents. Ensures that
 * the sum of all reserved amounts never exceeds available cash, preventing
 * multiple concurrent strategies from over-committing capital before orders
 * are filled or rejected.
 *
 * Supports both single-intent and group-level (multi-leg) reservations.
 * Group reservations are atomic: if the full group cost exceeds available
 * cash, no reservation is made for any intent in the group.
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

/** Callback to estimate the current market price for a symbol */
export type PriceEstimator = (symbol: string) => number;

export class CapitalReservationManager {
  private readonly _reservations: Map<UUID, CapitalReservation> = new Map();

  /**
   * Estimates the capital cost for a single order intent.
   * - Buy orders: qty × (limitPrice or estimated market price)
   * - Sell orders: $0 (sells generate proceeds, not costs)
   * @param intent - OrderIntent to estimate cost for
   * @param priceEstimator - Callback returning current price for a symbol
   * @returns Estimated cost in USD (0 for sell-side intents)
   */
  estimateCost(intent: OrderIntent, priceEstimator?: PriceEstimator): number {
    // Sell orders generate proceeds, they don't consume capital
    if (intent.side === "sell") return 0;

    const price = intent.limitPrice ?? (priceEstimator ? priceEstimator(intent.symbol) : 0);
    return intent.qty * price;
  }

  /**
   * Attempts to reserve capital for a pending order intent.
   * Returns null if estimated cost is zero or exceeds available cash.
   * @param intent - OrderIntent to reserve capital for
   * @param totalCash - Current total cash balance (before reservations)
   * @param priceEstimator - Optional callback for market price estimation
   * @returns Reservation receipt, or null if insufficient capital
   */
  reserve(
    intent: OrderIntent,
    totalCash: number,
    priceEstimator?: PriceEstimator,
  ): { reservationId: UUID; amount: number } | null {
    const amount = this.estimateCost(intent, priceEstimator);

    // Sell orders or zero-cost intents don't need reservation
    if (amount <= 0) {
      if (intent.side === "sell") {
        // Sells don't need capital — return a zero-cost reservation for tracking
        const reservationId = newId();
        const reservation: CapitalReservation = {
          reservationId,
          amount: 0,
          strategyId: intent.strategyId,
          intentId: intent.id,
          ts: nowMs(),
        };
        this._reservations.set(reservationId, reservation);
        return { reservationId, amount: 0 };
      }

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
   * Reserves capital for an entire signal group atomically.
   * Computes total buy-side cost across all intents. If the total exceeds
   * available cash, no reservations are made for any intent in the group.
   *
   * @param intents - All OrderIntents in the signal group
   * @param totalCash - Current total cash balance
   * @param priceEstimator - Callback returning current price for a symbol
   * @returns Reservation receipt with total amount, or null if insufficient capital
   */
  reserveGroup(
    intents: OrderIntent[],
    totalCash: number,
    priceEstimator?: PriceEstimator,
  ): { reservationId: UUID; amount: number } | null {
    // Calculate total cost across all buy-side intents
    let totalAmount = 0;
    for (const intent of intents) {
      totalAmount += this.estimateCost(intent, priceEstimator);
    }

    // All sell or zero-cost group — create tracking reservation
    if (totalAmount <= 0) {
      const reservationId = newId();
      const reservation: CapitalReservation = {
        reservationId,
        amount: 0,
        strategyId: intents[0]?.strategyId ?? "unknown",
        intentId: intents[0]?.id ?? "unknown",
        ts: nowMs(),
      };
      this._reservations.set(reservationId, reservation);
      return { reservationId, amount: 0 };
    }

    const available = this.getAvailableCash(totalCash);
    if (totalAmount > available) {
      logger.info("CapitalReservationManager: insufficient capital for group reservation", {
        intentCount: intents.length,
        required: totalAmount,
        available,
        alreadyReserved: this.getReservedTotal(),
      });
      return null;
    }

    const reservationId = newId();
    const reservation: CapitalReservation = {
      reservationId,
      amount: totalAmount,
      strategyId: intents[0]?.strategyId ?? "unknown",
      intentId: intents[0]?.id ?? "unknown",
      ts: nowMs(),
    };

    this._reservations.set(reservationId, reservation);
    logger.info("CapitalReservationManager: reserved capital for group", {
      reservationId,
      amount: totalAmount,
      intentCount: intents.length,
      strategyId: reservation.strategyId,
      totalReserved: this.getReservedTotal(),
    });

    return { reservationId, amount: totalAmount };
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
   * Returns the reservation for a given reservation ID, or null if not found.
   * @param reservationId - Reservation ID to look up
   * @returns CapitalReservation or null
   */
  getReservation(reservationId: UUID): CapitalReservation | null {
    return this._reservations.get(reservationId) ?? null;
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
   * Returns the count of active reservations. Useful for diagnostics.
   * @returns Number of active reservations
   */
  get reservationCount(): number {
    return this._reservations.size;
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
