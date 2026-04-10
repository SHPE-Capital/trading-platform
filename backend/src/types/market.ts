/**
 * market.ts
 *
 * Types representing raw and normalized market data: quotes, trades, and bars.
 * These are the fundamental market data primitives that flow through the system.
 *
 * Inputs:  Raw data from Alpaca (via adapter/normalizer).
 * Outputs: Normalized internal representations consumed by core state and strategies.
 */

import type { EpochMs, Symbol, ISOTimestamp } from "./common";

// ------------------------------------------------------------------
// Quote (top-of-book bid/ask snapshot)
// ------------------------------------------------------------------

/** A normalized best bid/offer (BBO) quote snapshot for a symbol. */
export interface Quote {
  /** Ticker symbol */
  symbol: Symbol;
  /** Bid price */
  bidPrice: number;
  /** Ask price */
  askPrice: number;
  /** Bid size (shares/units) */
  bidSize: number;
  /** Ask size (shares/units) */
  askSize: number;
  /** Midprice computed as (bid + ask) / 2 */
  midPrice: number;
  /** Bid-ask spread: ask - bid */
  spread: number;
  /**
   * Microprice: a size-weighted midprice that accounts for order book imbalance.
   * microprice = (askSize * bid + bidSize * ask) / (bidSize + askSize)
   */
  microPrice: number;
  /** Quote imbalance: (bidSize - askSize) / (bidSize + askSize). Range: [-1, 1] */
  imbalance: number;
  /** Unix timestamp in milliseconds */
  ts: EpochMs;
  /** ISO 8601 timestamp from exchange */
  isoTs: ISOTimestamp;
  /** Exchange that produced the quote */
  exchange?: string;
  /** Conditions/flags from the exchange */
  conditions?: string[];
}

// ------------------------------------------------------------------
// Trade (last-sale execution)
// ------------------------------------------------------------------

/** A normalized trade (tape print / last-sale event) for a symbol. */
export interface Trade {
  /** Ticker symbol */
  symbol: Symbol;
  /** Execution price */
  price: number;
  /** Executed size (shares/units) */
  size: number;
  /** Unix timestamp in milliseconds */
  ts: EpochMs;
  /** ISO 8601 timestamp from exchange */
  isoTs: ISOTimestamp;
  /** Exchange where the trade occurred */
  exchange?: string;
  /** Tape (A, B, C) */
  tape?: string;
  /** Trade conditions/flags */
  conditions?: string[];
  /** Trade ID from exchange */
  id?: string;
}

// ------------------------------------------------------------------
// Bar (OHLCV candle)
// ------------------------------------------------------------------

/** A normalized OHLCV bar (candle) for a symbol and timeframe. */
export interface Bar {
  /** Ticker symbol */
  symbol: Symbol;
  /** Open price for the period */
  open: number;
  /** High price for the period */
  high: number;
  /** Low price for the period */
  low: number;
  /** Close price for the period */
  close: number;
  /** Volume traded during the period */
  volume: number;
  /** Volume-weighted average price */
  vwap?: number;
  /** Number of trades during the period */
  tradeCount?: number;
  /** Bar period start timestamp (Unix ms) */
  ts: EpochMs;
  /** Bar period start (ISO 8601) */
  isoTs: ISOTimestamp;
  /** Timeframe label (e.g. "1m", "5m", "1d") */
  timeframe: string;
}

// ------------------------------------------------------------------
// Order Book (Level 2, optional / future use)
// ------------------------------------------------------------------

/** A single price level in an order book */
export interface BookLevel {
  price: number;
  size: number;
}

/** A normalized Level 2 order book snapshot */
export interface OrderBook {
  symbol: Symbol;
  bids: BookLevel[];
  asks: BookLevel[];
  ts: EpochMs;
}

// ------------------------------------------------------------------
// Derived market metrics (computed from raw data)
// ------------------------------------------------------------------

/** Derived microstructure metrics computed from a quote */
export interface MicrostructureSnapshot {
  symbol: Symbol;
  midPrice: number;
  microPrice: number;
  spread: number;
  imbalance: number;
  ts: EpochMs;
}
