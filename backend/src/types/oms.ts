/**
 * types/oms.ts
 *
 * Types for the Order Management System (OMS) layer: capital reservations,
 * queued order intents, parent-child order tracking, and algo parameters.
 *
 * Inputs:  N/A — type definitions only.
 * Outputs: N/A — type definitions only.
 */

import type { UUID, EpochMs, OrderType, ExecutionAlgoType } from "./common";
import type { OrderIntent } from "./orders";

// ------------------------------------------------------------------
// Capital Reservation
// ------------------------------------------------------------------

/** A reserved capital allocation for a pending order intent. */
export interface CapitalReservation {
  /** Unique reservation ID */
  reservationId: UUID;
  /** USD amount reserved */
  amount: number;
  /** Strategy that owns this reservation */
  strategyId: string;
  /** Intent this reservation is associated with */
  intentId: UUID;
  /** When the reservation was created (Unix ms) */
  ts: EpochMs;
}

// ------------------------------------------------------------------
// Order Queue
// ------------------------------------------------------------------

/** An order intent decorated with queue metadata for priority ordering. */
export interface QueuedOrderIntent {
  /** The order intent awaiting submission */
  intent: OrderIntent;
  /** Higher values are dequeued first */
  priority: number;
  /** When the intent was enqueued (Unix ms) */
  enqueuedAt: EpochMs;
  /** Capital reservation ID, if one has been made for this intent */
  reservationId?: UUID;
  /** Signal group this intent belongs to (for multi-leg atomic execution) */
  groupId?: UUID;
}

// ------------------------------------------------------------------
// Parent-Child Order Tracking
// ------------------------------------------------------------------

/**
 * A parent order representing a large intent that is being executed
 * algorithmically (TWAP, VWAP) as a series of child orders.
 */
export interface ParentOrder {
  /** Unique parent order ID */
  parentId: UUID;
  /** Original intent ID this parent was created from */
  intentId: UUID;
  /** Originating strategy */
  strategyId: string;
  /** Symbol being traded */
  symbol: string;
  /** Total quantity to fill */
  totalQty: number;
  /** Quantity filled so far across all children */
  filledQty: number;
  /** IDs of all child orders created for this parent */
  childIds: UUID[];
  /** Which algo is executing this parent */
  algoType: ExecutionAlgoType;
  /** Algo-specific parameters */
  algoParams: TwapParams | VwapParams;
  /** When the parent was created (Unix ms) */
  createdAt: EpochMs;
  /** When all children were filled or the parent was canceled (Unix ms) */
  completedAt?: EpochMs;
}

/** A single slice of a parent order submitted to the market. */
export interface ChildOrder {
  /** Unique child order ID */
  childId: UUID;
  /** Parent this child belongs to */
  parentId: UUID;
  /** Child intent ID submitted to the execution sink */
  intentId: UUID;
  /** Zero-based index of this slice within the parent */
  sliceIndex: number;
  /** Total slices planned for the parent */
  totalSlices: number;
  /** Quantity targeted by this child */
  qty: number;
  /** Quantity filled for this child */
  filledQty: number;
  /** When the child intent was submitted (Unix ms) */
  submittedAt?: EpochMs;
  /** When the child was fully filled (Unix ms) */
  filledAt?: EpochMs;
}

// ------------------------------------------------------------------
// Algo Parameters
// ------------------------------------------------------------------

/** Parameters for TWAP (Time-Weighted Average Price) execution. */
export interface TwapParams {
  /** Total quantity to execute */
  totalQty: number;
  /** Start of the execution window (Unix ms) */
  startTime: EpochMs;
  /** End of the execution window (Unix ms) */
  endTime: EpochMs;
  /** Number of equal-size slices to divide the order into */
  numSlices: number;
  /** Order type for each child slice */
  sliceOrderType: OrderType;
  /** Allowed limit price tolerance as a fraction (e.g. 0.001 = 10bps) */
  limitPriceTolerancePct: number;
}

/** Parameters for VWAP (Volume-Weighted Average Price) execution. */
export interface VwapParams {
  /** Total quantity to execute */
  totalQty: number;
  /** Start of the execution window (Unix ms) */
  startTime: EpochMs;
  /** End of the execution window (Unix ms) */
  endTime: EpochMs;
  /** Target fraction of observed market volume per interval (e.g. 0.10 = 10%) */
  participationRate: number;
  /** Maximum allowable slippage as a fraction before abandoning (e.g. 0.005 = 50bps) */
  maxSlippage: number;
}

// ------------------------------------------------------------------
// Signal Group (multi-leg atomic execution)
// ------------------------------------------------------------------

/**
 * A group of order intents that must be executed atomically.
 * Used for multi-leg signals like pairs trades where both legs
 * must execute or neither should. Capital is reserved for the
 * entire group before any intent is enqueued.
 */
export interface SignalGroup {
  /** Unique group ID */
  groupId: UUID;
  /** Strategy that generated the signal group */
  strategyId: string;
  /** Strategy type (used for priority lookup) */
  strategyType: string;
  /** All intents in this group */
  intents: OrderIntent[];
  /** Total USD capital required for all buy-side intents */
  totalCapitalRequired: number;
  /** Reservation ID once capital is reserved */
  reservationId?: UUID;
  /** Computed priority for queue ordering */
  priority: number;
  /** Signal confidence (0-1) if available */
  confidence?: number;
  /** When the group was created (Unix ms) */
  createdAt: EpochMs;
}
