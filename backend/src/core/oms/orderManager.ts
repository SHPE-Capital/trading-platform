/**
 * core/oms/orderManager.ts
 *
 * Central Order Management System (OMS) coordinator. Manages the full
 * order lifecycle from signal to execution:
 *
 *   Signal → OMS (reserve capital + priority queue) → Risk → Execution
 *
 * Prevents over-commitment of capital when multiple strategies generate
 * signals simultaneously. Groups multi-leg signals (e.g., pairs trades)
 * so they are reserved and executed atomically.
 *
 * Inputs:  SignalGroups or individual OrderIntents from the Orchestrator.
 * Outputs: Validated, prioritized orders submitted to the ExecutionEngine.
 *          Emits OMS events (CAPITAL_RESERVED, CAPITAL_UNAVAILABLE, ORDER_QUEUED).
 */

import { CapitalReservationManager } from "./capitalReservation";
import { OrderIntentQueue } from "./orderQueue";
import { getSignalPriority } from "./priorityConfig";
import { RiskEngine } from "../risk/riskEngine";
import { ExecutionEngine } from "../execution/executionEngine";
import { PortfolioStateManager } from "../state/portfolioState";
import { SymbolStateManager } from "../state/symbolState";
import { EventBus } from "../engine/eventBus";
import { logger } from "../../utils/logger";
import { newId } from "../../utils/ids";
import { nowMs } from "../../utils/time";
import type { UUID, ExecutionMode } from "../../types/common";
import type { OrderIntent } from "../../types/orders";
import type { SignalGroup } from "../../types/oms";

export class OrderManagerService {
  /** Maps intentId → reservationId for release on fill/cancel */
  private readonly _intentReservationMap: Map<UUID, UUID> = new Map();

  constructor(
    private readonly capitalMgr: CapitalReservationManager,
    private readonly queue: OrderIntentQueue,
    private readonly riskEngine: RiskEngine,
    private readonly executionEngine: ExecutionEngine,
    private readonly portfolioState: PortfolioStateManager,
    private readonly symbolState: SymbolStateManager,
    private readonly eventBus: EventBus,
    private readonly mode: ExecutionMode,
  ) {}

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Entry point: accepts a signal group (1+ intents from the same signal).
   * 1. Estimates total capital needed using current market prices
   * 2. Atomically reserves capital for the entire group
   * 3. Enqueues all intents with computed priority
   * 4. Triggers the drain loop
   *
   * If capital reservation fails, emits CAPITAL_UNAVAILABLE and returns
   * without enqueuing any intents.
   *
   * @param group - Signal group containing one or more OrderIntents
   */
  submitSignalGroup(group: SignalGroup): void {
    logger.info("OrderManagerService: submitting signal group", {
      groupId: group.groupId,
      strategyId: group.strategyId,
      intentCount: group.intents.length,
      strategyType: group.strategyType,
    });

    const totalCash = this.portfolioState.getCash();
    const priceEstimator = (symbol: string) => {
      const state = this.symbolState.get(symbol);
      return state?.latestMid ?? 0;
    };

    // Attempt atomic capital reservation for the full group
    const reservation = this.capitalMgr.reserveGroup(
      group.intents,
      totalCash,
      priceEstimator,
    );

    if (!reservation) {
      // Compute the total required for the error event
      let totalRequired = 0;
      for (const intent of group.intents) {
        totalRequired += this.capitalMgr.estimateCost(intent, priceEstimator);
      }

      logger.warn("OrderManagerService: capital unavailable for group", {
        groupId: group.groupId,
        required: totalRequired,
        available: this.capitalMgr.getAvailableCash(totalCash),
      });

      // Emit CAPITAL_UNAVAILABLE for the group (use first intent as representative)
      for (const intent of group.intents) {
        this.eventBus.publish({
          id: newId(),
          type: "CAPITAL_UNAVAILABLE",
          ts: nowMs(),
          mode: this.mode,
          intentId: intent.id,
          strategyId: group.strategyId,
          required: totalRequired,
          available: this.capitalMgr.getAvailableCash(totalCash),
        });
      }
      return;
    }

    // Emit CAPITAL_RESERVED
    this.eventBus.publish({
      id: newId(),
      type: "CAPITAL_RESERVED",
      ts: nowMs(),
      mode: this.mode,
      reservationId: reservation.reservationId,
      amount: reservation.amount,
      intentId: group.intents[0]?.id ?? group.groupId,
      strategyId: group.strategyId,
    });

    // Enqueue all intents in the group with the shared reservation
    for (const intent of group.intents) {
      this._intentReservationMap.set(intent.id, reservation.reservationId);

      this.queue.enqueue(
        intent,
        group.priority,
        group.groupId,
        reservation.reservationId,
      );

      this.eventBus.publish({
        id: newId(),
        type: "ORDER_QUEUED",
        ts: nowMs(),
        mode: this.mode,
        intentId: intent.id,
        strategyId: group.strategyId,
        priority: group.priority,
        queueDepth: this.queue.size(),
      });
    }

    // Trigger drain
    this.drain();
  }

  /**
   * Convenience: submit a single intent (wraps in a 1-element group).
   * Computes priority from strategy type and signal confidence.
   *
   * @param intent - Single OrderIntent to submit
   * @param strategyType - Strategy type for priority lookup
   * @param confidence - Optional signal confidence (0–1)
   */
  submitIntent(
    intent: OrderIntent,
    strategyType: string,
    confidence?: number,
  ): void {
    const priority = getSignalPriority(strategyType, confidence);

    const group: SignalGroup = {
      groupId: newId(),
      strategyId: intent.strategyId,
      strategyType,
      intents: [intent],
      totalCapitalRequired: 0, // computed in submitSignalGroup
      priority,
      confidence,
      createdAt: nowMs(),
    };

    this.submitSignalGroup(group);
  }

  /**
   * Drain loop: processes the queue in priority order.
   *
   * For each queued intent:
   *   1. Run risk check against the CURRENT portfolio snapshot
   *   2. If passed → submit to ExecutionEngine
   *   3. If failed → release reservation, emit RISK_REJECTED
   *
   * The drain is synchronous: in simulated mode, fills update portfolio
   * state inline via the EventBus, so each subsequent risk check sees
   * accurate data. For live/paper mode, capital is already reserved
   * to prevent over-commitment regardless of async fill timing.
   */
  drain(): void {
    const items = this.queue.drainAll();
    if (items.length === 0) return;

    logger.info("OrderManagerService: starting drain", { count: items.length });

    for (const item of items) {
      const intent = item.intent;

      // Run risk check against current portfolio snapshot
      const portfolio = this.portfolioState.getSnapshot();
      const riskResult = this.riskEngine.check(intent, portfolio);

      if (!riskResult.passed) {
        logger.info("OrderManagerService: risk rejected during drain", {
          intentId: intent.id,
          reason: riskResult.reason,
        });

        this.eventBus.publish({
          id: newId(),
          type: "RISK_REJECTED",
          ts: nowMs(),
          mode: this.mode,
          strategyId: intent.strategyId,
          reason: riskResult.reason ?? "Risk check failed",
          rejectedIntent: intent,
        });

        // Release capital reservation for this intent
        this._releaseReservationForIntent(intent.id);
        continue;
      }

      // Submit to execution engine (fire-and-forget for async sinks)
      this.executionEngine.submit(intent).catch((err) => {
        logger.error("OrderManagerService: execution submission failed", {
          intentId: intent.id,
          error: String(err),
        });
        this._releaseReservationForIntent(intent.id);
      });

      // Emit ORDER_INTENT_CREATED for any listeners that track intents
      this.eventBus.publish({
        id: newId(),
        type: "ORDER_INTENT_CREATED",
        ts: nowMs(),
        mode: this.mode,
        strategyId: intent.strategyId,
        payload: intent,
      });
    }

    logger.info("OrderManagerService: drain complete", { processed: items.length });
  }

  /**
   * Called when an order is filled. Releases the capital reservation
   * for the filled intent since the actual fill has been applied to
   * the portfolio balance.
   *
   * @param intentId - Intent ID of the filled order
   */
  onOrderFilled(intentId: UUID): void {
    this._releaseReservationForIntent(intentId);
  }

  /**
   * Called when an order is canceled or rejected. Releases the capital
   * reservation so the funds become available for other orders.
   *
   * @param intentId - Intent ID of the canceled/rejected order
   */
  onOrderCanceled(intentId: UUID): void {
    this._releaseReservationForIntent(intentId);
  }

  /**
   * Returns the current queue depth.
   * @returns Number of intents waiting in the queue
   */
  get queueDepth(): number {
    return this.queue.size();
  }

  /**
   * Returns the total capital currently reserved.
   * @returns Reserved amount in USD
   */
  get reservedCapital(): number {
    return this.capitalMgr.getReservedTotal();
  }

  /**
   * Clears all OMS state: queue, reservations, and intent-reservation mappings.
   * Used on engine stop or kill switch activation.
   */
  clear(): void {
    this.queue.clear();
    this.capitalMgr.clear();
    this._intentReservationMap.clear();
    logger.info("OrderManagerService: cleared all OMS state");
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  /**
   * Releases the capital reservation associated with an intent ID.
   * Handles the case where no reservation exists (e.g., sell orders).
   */
  private _releaseReservationForIntent(intentId: UUID): void {
    const reservationId = this._intentReservationMap.get(intentId);
    if (!reservationId) return;

    // Only release if the reservation still exists
    // (group reservations may be shared across multiple intents)
    const reservation = this.capitalMgr.getReservation(reservationId);
    if (reservation) {
      this.capitalMgr.release(reservationId);

      this.eventBus.publish({
        id: newId(),
        type: "CAPITAL_RELEASED",
        ts: nowMs(),
        mode: this.mode,
        reservationId,
        reason: "filled",
      });
    }

    this._intentReservationMap.delete(intentId);
  }
}
