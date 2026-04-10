/**
 * common.ts
 *
 * Shared primitive and utility types used throughout the backend.
 *
 * Inputs:  N/A — type definitions only.
 * Outputs: N/A — type definitions only.
 */

/** ISO 8601 timestamp string (e.g. "2024-01-15T09:30:00.000Z") */
export type ISOTimestamp = string;

/** Unix epoch in milliseconds */
export type EpochMs = number;

/** A financial instrument ticker symbol (e.g. "AAPL", "SPY") */
export type Symbol = string;

/** Unique identifier string (UUID v4) */
export type UUID = string;

/** Execution mode the engine is currently running in */
export type ExecutionMode = "live" | "paper" | "backtest" | "replay";

/** Side of a trade or order */
export type OrderSide = "buy" | "sell";

/** Order type for submission */
export type OrderType = "market" | "limit" | "stop" | "stop_limit";

/** Time-in-force instruction for an order */
export type TimeInForce = "day" | "gtc" | "ioc" | "fok" | "opg" | "cls";

/** Current lifecycle status of an order */
export type OrderStatus =
  | "pending"
  | "submitted"
  | "acknowledged"
  | "partial_fill"
  | "filled"
  | "canceled"
  | "expired"
  | "rejected";

/** Asset class */
export type AssetClass = "us_equity" | "crypto" | "option";

/** Bar / candle aggregation timeframe */
export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";

/** Generic key-value metadata bag */
export type Metadata = Record<string, unknown>;

/**
 * Generic result wrapper for operations that can fail.
 * Prefer this over throwing for expected errors.
 */
export type Result<T, E = string> =
  | { success: true; data: T }
  | { success: false; error: E };

/** Paginated list response */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
