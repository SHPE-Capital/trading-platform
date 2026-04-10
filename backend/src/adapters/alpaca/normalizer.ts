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

import type { Quote, Trade, Bar } from "../../types/market";
import { isoToMs } from "../../utils/time";

// ------------------------------------------------------------------
// Raw Alpaca message shapes (minimal — only fields we consume)
// ------------------------------------------------------------------

interface AlpacaRawQuote {
  S: string;    // symbol
  bp: number;   // bid price
  ap: number;   // ask price
  bs: number;   // bid size
  as: number;   // ask size
  t: string;    // timestamp ISO
  x?: string;   // exchange
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
  const ts = isoToMs(raw.t);

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
    ts: isoToMs(raw.t),
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
    ts: isoToMs(raw.t),
    isoTs: raw.t,
    timeframe,
  };
}
