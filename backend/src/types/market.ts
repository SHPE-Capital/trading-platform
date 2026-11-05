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

/** The kinds of market data event that reach symbol state and strategies. */
export type MarketEventKind = "bar" | "quote" | "trade";

/** Alpaca historical data feeds: consolidated across all exchanges (SIP), or IEX only. */
export type HistoricalFeed = "sip" | "iex";

/** Tick-level historical record kinds, named as Alpaca's endpoints are. */
export type TickKind = "quotes" | "trades";

/** A historical quote or trade exactly as Alpaca returned it; `t` is RFC 3339 with up to nanoseconds. */
export interface RawTick {
  t: string;
  [field: string]: unknown;
}

// ------------------------------------------------------------------
// Quote (top-of-book bid/ask snapshot)
// ------------------------------------------------------------------

/**
 * A normalized top-of-book quote snapshot for a symbol. On Alpaca's IEX feed
 * this is IEX's own book, not the consolidated NBBO.
 */
export interface Quote {
  /** Ticker symbol */
  symbol: Symbol;
  /** Bid price */
  bidPrice: number;
  /** Ask price */
  askPrice: number;
  /**
   * Bid size in the provider's unit. Alpaca's stock stream reports quote sizes
   * in round lots, not shares (see QUOTE_SIZE_UNIT in the normalizer). Only
   * ratios (microPrice, imbalance) are unit-free.
   */
  bidSize: number;
  /** Ask size in the provider's unit (round lots on Alpaca). */
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
  /** Exchange that produced the quote (unused by Alpaca stock quotes, which report per-side venues) */
  exchange?: string;
  /** Venue of the bid (Alpaca `bx`) */
  bidExchange?: string;
  /** Venue of the ask (Alpaca `ax`) */
  askExchange?: string;
  /** Tape (A, B, C) */
  tape?: string;
  /** Conditions/flags from the exchange */
  conditions?: string[];
}

/**
 * Why a market-data message is unusable or suspicious. "reject" issues are
 * dropped when the adapter's invalid-data policy is "quarantine"; "flag" issues
 * are legitimate market states that are only counted.
 */
export type MarketDataIssueCode =
  | "MISSING_FIELD"
  | "BAD_TIMESTAMP"
  | "NON_FINITE_PRICE"
  | "NON_POSITIVE_PRICE"
  | "ONE_SIDED_QUOTE"
  | "CROSSED_QUOTE"
  | "NEGATIVE_SIZE"
  | "INVALID_BAR_RANGE"
  | "LOCKED_QUOTE"
  | "ZERO_SIZE";

export interface MarketDataIssue {
  code: MarketDataIssueCode;
  severity: "reject" | "flag";
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

/** A provider correction of an earlier trade print (Alpaca `c`). */
export interface TradeCorrection {
  symbol: Symbol;
  /** Id of the trade being corrected. */
  originalId: string;
  originalPrice: number;
  originalSize: number;
  /** The trade as it should have been printed. */
  corrected: Trade;
}

/** A provider cancel or error of an earlier trade print (Alpaca `x`). */
export interface TradeCancel {
  symbol: Symbol;
  tradeId: string;
  price: number;
  size: number;
  /** "C" cancel, "E" error (Alpaca `a`). */
  action: string;
  ts: EpochMs;
  isoTs: ISOTimestamp;
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
