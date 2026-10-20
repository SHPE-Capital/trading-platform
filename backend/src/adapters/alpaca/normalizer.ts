/**
 * adapters/alpaca/normalizer.ts
 *
 * Translates raw Alpaca WebSocket message payloads into normalized internal
 * types (Quote, Trade, Bar). No Alpaca-specific structure should leak
 * beyond this file into the core engine.
 *
 * Inputs:  Raw Alpaca message objects from the WebSocket stream.
 * Outputs: Normalized Quote, Trade, and Bar objects ready for the EventBus.
 */

import type { Quote, Trade, Bar, MarketDataIssue } from "../../types/market";
import { parseRfc3339Parts, rfc3339ToEpochMs } from "../../core/telemetry/clock";

/**
 * Bump when normalized output changes for the same input, so benchmark runs
 * and recordings name the normalizer they were measured with.
 *   1: initial quote/trade/bar mapping
 *   2: quotes keep per-side venues (bx/ax) and tape (z); validation added
 */
export const NORMALIZER_VERSION = "alpaca-stock-v2/2";

/**
 * Alpaca's stock stream documents quote bid/ask sizes "in round lots", not
 * shares. Values pass through unconverted; microPrice and imbalance are ratios
 * and unaffected. Convert explicitly (lot size is usually 100 shares) before
 * using a size as a share quantity.
 */
export const QUOTE_SIZE_UNIT = "round_lots";

// ------------------------------------------------------------------
// Raw Alpaca message shapes (minimal — only fields we consume)
// ------------------------------------------------------------------

interface AlpacaRawQuote {
  S: string;    // symbol
  bp: number;   // bid price
  ap: number;   // ask price
  bs: number;   // bid size (round lots)
  as: number;   // ask size (round lots)
  t: string;    // timestamp RFC-3339, nanosecond precision
  bx?: string;  // bid exchange
  ax?: string;  // ask exchange
  x?: string;   // exchange (not sent for stock quotes; kept for compatibility)
  z?: string;   // tape
  c?: string[]; // conditions
}

interface AlpacaRawTrade {
  S: string;    // symbol
  p: number;    // price
  s: number;    // size
  t: string;    // timestamp ISO
  x?: string;   // exchange
  z?: string;   // tape
  c?: string[]; // conditions
  i?: number;   // trade ID
}

interface AlpacaRawBar {
  S: string;   // symbol
  o: number;   // open
  h: number;   // high
  l: number;   // low
  c: number;   // close
  v: number;   // volume
  vw?: number; // vwap
  n?: number;  // trade count
  t: string;   // timestamp ISO
}

// ------------------------------------------------------------------
// Normalizer functions
// ------------------------------------------------------------------

/**
 * Normalizes an Alpaca raw quote message into an internal Quote.
 * Computes derived fields: midPrice, spread, microPrice, imbalance.
 * @param raw - Raw Alpaca quote object from WebSocket
 * @returns Normalized Quote
 */
export function normalizeQuote(raw: AlpacaRawQuote): Quote {
  const bid = raw.bp;
  const ask = raw.ap;
  const bidSize = raw.bs;
  const askSize = raw.as;
  const mid = (bid + ask) / 2;
  const spread = ask - bid;
  const totalSize = bidSize + askSize;
  const microPrice = totalSize > 0 ? (askSize * bid + bidSize * ask) / totalSize : mid;
  const imbalance = totalSize > 0 ? (bidSize - askSize) / totalSize : 0;
  const ts = rfc3339ToEpochMs(raw.t);

  return {
    symbol: raw.S,
    bidPrice: bid,
    askPrice: ask,
    bidSize,
    askSize,
    midPrice: mid,
    spread,
    microPrice,
    imbalance,
    ts,
    isoTs: raw.t,
    exchange: raw.x,
    bidExchange: raw.bx,
    askExchange: raw.ax,
    tape: raw.z,
    conditions: raw.c,
  };
}

/**
 * Normalizes an Alpaca raw trade message into an internal Trade.
 * @param raw - Raw Alpaca trade object from WebSocket
 * @returns Normalized Trade
 */
export function normalizeTrade(raw: AlpacaRawTrade): Trade {
  return {
    symbol: raw.S,
    price: raw.p,
    size: raw.s,
    ts: rfc3339ToEpochMs(raw.t),
    isoTs: raw.t,
    exchange: raw.x,
    tape: raw.z,
    conditions: raw.c,
    id: raw.i !== undefined ? String(raw.i) : undefined,
  };
}

/**
 * Normalizes an Alpaca raw bar message into an internal Bar.
 * @param raw - Raw Alpaca bar object from WebSocket or REST
 * @param timeframe - Timeframe label for this bar (e.g. "1m")
 * @returns Normalized Bar
 */
export function normalizeBar(raw: AlpacaRawBar, timeframe: string): Bar {
  return {
    symbol: raw.S,
    open: raw.o,
    high: raw.h,
    low: raw.l,
    close: raw.c,
    volume: raw.v,
    vwap: raw.vw,
    tradeCount: raw.n,
    ts: rfc3339ToEpochMs(raw.t),
    isoTs: raw.t,
    timeframe,
  };
}

// ------------------------------------------------------------------
// Validation
//
// Checks the raw message, not the normalized value: a one-sided IEX quote
// (bp or ap = 0) normalizes to a mid of half the price, which looks plausible
// and is exactly the silent repair to avoid. "reject" issues are unusable for
// prices; "flag" issues are real market states that are only counted.
// ------------------------------------------------------------------

const reject = (code: MarketDataIssue["code"]): MarketDataIssue => ({ code, severity: "reject" });
const flag = (code: MarketDataIssue["code"]): MarketDataIssue => ({ code, severity: "flag" });

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function commonIssue(raw: Record<string, unknown>): MarketDataIssue | null {
  if (typeof raw["S"] !== "string" || raw["S"] === "") return reject("MISSING_FIELD");
  if (typeof raw["t"] !== "string") return reject("MISSING_FIELD");
  if (parseRfc3339Parts(raw["t"]) === null) return reject("BAD_TIMESTAMP");
  return null;
}

/** First problem found in a raw quote message, or null when it is usable. */
export function validateRawQuote(raw: Record<string, unknown>): MarketDataIssue | null {
  const common = commonIssue(raw);
  if (common) return common;
  const { bp, ap, bs, as: askSize } = raw;
  if (bp === undefined || ap === undefined || bs === undefined || askSize === undefined) return reject("MISSING_FIELD");
  if (!isFiniteNumber(bp) || !isFiniteNumber(ap) || !isFiniteNumber(bs) || !isFiniteNumber(askSize)) {
    return reject("NON_FINITE_PRICE");
  }
  if (bs < 0 || askSize < 0) return reject("NEGATIVE_SIZE");
  if (bp <= 0 && ap <= 0) return reject("NON_POSITIVE_PRICE");
  if (bp <= 0 || ap <= 0) return reject("ONE_SIDED_QUOTE");
  if (bp > ap) return reject("CROSSED_QUOTE");
  if (bp === ap) return flag("LOCKED_QUOTE");
  if (bs === 0 || askSize === 0) return flag("ZERO_SIZE");
  return null;
}

/** First problem found in a raw trade message, or null when it is usable. */
export function validateRawTrade(raw: Record<string, unknown>): MarketDataIssue | null {
  const common = commonIssue(raw);
  if (common) return common;
  const { p, s } = raw;
  if (p === undefined || s === undefined) return reject("MISSING_FIELD");
  if (!isFiniteNumber(p) || !isFiniteNumber(s)) return reject("NON_FINITE_PRICE");
  if (p <= 0) return reject("NON_POSITIVE_PRICE");
  if (s < 0) return reject("NEGATIVE_SIZE");
  if (s === 0) return flag("ZERO_SIZE");
  return null;
}

/** First problem found in a raw bar message, or null when it is usable. */
export function validateRawBar(raw: Record<string, unknown>): MarketDataIssue | null {
  const common = commonIssue(raw);
  if (common) return common;
  const { o, h, l, c, v } = raw;
  if (o === undefined || h === undefined || l === undefined || c === undefined || v === undefined) {
    return reject("MISSING_FIELD");
  }
  if (![o, h, l, c, v].every(isFiniteNumber)) return reject("NON_FINITE_PRICE");
  const [open, high, low, close, volume] = [o, h, l, c, v] as number[];
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return reject("NON_POSITIVE_PRICE");
  if (volume < 0) return reject("NEGATIVE_SIZE");
  if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) return reject("INVALID_BAR_RANGE");
  return null;
}
