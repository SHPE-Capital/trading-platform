/**
 * orders.ts
 *
 * Types for order management: intents, submitted orders, fills,
 * and order lifecycle state. These flow through execution and risk layers.
 *
 * Inputs:  Strategy signals → OrderIntent → submitted Order → Fill.
 * Outputs: Order state updates consumed by portfolio state and frontend APIs.
 */

import type {
  UUID,
  EpochMs,
  ISOTimestamp,
  Symbol,
  OrderSide,
  OrderType,
  TimeInForce,
  OrderStatus,
  Metadata,
} from "./common";

// ------------------------------------------------------------------
// Order Intent
// ------------------------------------------------------------------

/**
 * An order intent is what a strategy emits — a desire to trade.
 * It has not yet been validated by risk or submitted to a broker.
 */
export interface OrderIntent {
  /** Unique intent ID */
  id: UUID;
  /** Originating strategy ID */
  strategyId: string;
  /** Instrument to trade */
  symbol: Symbol;
  /** Buy or sell */
  side: OrderSide;
  /** Quantity (shares/units) */
  qty: number;
  /** Order type */
  orderType: OrderType;
  /** Limit price (required for limit and stop_limit orders) */
  limitPrice?: number;
  /** Stop price (required for stop and stop_limit orders) */
  stopPrice?: number;
  /** Time in force */
  timeInForce: TimeInForce;
  /** Strategy-supplied reason/label for this order */
  reason?: string;
  /** When the intent was created (Unix ms) */
  ts: EpochMs;
  /** Optional metadata passthrough */
  meta?: Metadata;
}

// ------------------------------------------------------------------
// Submitted Order
// ------------------------------------------------------------------

/**
 * A fully tracked order after it has been submitted to the execution layer.
 * Tracks the full lifecycle from submission through fill or cancellation.
 */
export interface Order {
  /** Internal order ID */
  id: UUID;
  /** Broker-assigned order ID (e.g. Alpaca order ID) */
  brokerOrderId?: string;
  /** Originating intent ID */
  intentId: UUID;
  /** Originating strategy ID */
  strategyId: string;
  /** Instrument traded */
  symbol: Symbol;
  /** Side */
  side: OrderSide;
  /** Requested quantity */
  qty: number;
  /** Filled quantity so far */
  filledQty: number;
  /** Average fill price */
  avgFillPrice?: number;
  /** Order type */
  orderType: OrderType;
  /** Limit price */
  limitPrice?: number;
  /** Stop price */
  stopPrice?: number;
  /** Time in force */
  timeInForce: TimeInForce;
  /** Current lifecycle status */
  status: OrderStatus;
  /** When the order was submitted (Unix ms) */
  submittedAt: EpochMs;
  /** When the order was last updated (Unix ms) */
  updatedAt: EpochMs;
  /** When the order was fully filled or canceled */
  closedAt?: EpochMs;
  /** Fills associated with this order */
  fills: Fill[];
  /** Optional metadata */
  meta?: Metadata;
}

// ------------------------------------------------------------------
// Fill
// ------------------------------------------------------------------

/** A single execution fill event for an order. */
export interface Fill {
  /** Unique fill ID */
  id: UUID;
  /** Order this fill belongs to */
  orderId: UUID;
  /** Symbol filled */
  symbol: Symbol;
  /** Side of the fill */
  side: OrderSide;
  /** Quantity filled */
  qty: number;
  /** Fill price */
  price: number;
  /** Notional value of the fill */
  notional: number;
  /** Commission/fee for this fill */
  commission: number;
  /** When the fill occurred (Unix ms) */
  ts: EpochMs;
  /** ISO timestamp */
  isoTs: ISOTimestamp;
  /** Exchange where fill occurred */
  exchange?: string;
}

// ------------------------------------------------------------------
// Order Create / Update Helpers
// ------------------------------------------------------------------

/** Subset of Order fields needed to create a new Order from an intent */
export type CreateOrderInput = Omit<Order, "id" | "fills" | "status" | "filledQty" | "avgFillPrice" | "updatedAt" | "closedAt">;

/** Partial update payload for an existing order */
export type UpdateOrderInput = Partial<Pick<Order, "status" | "filledQty" | "avgFillPrice" | "brokerOrderId" | "updatedAt" | "closedAt">>;
