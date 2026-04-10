/**
 * types/market.ts
 *
 * Frontend types for market data: quotes, trades, bars.
 * These mirror the backend types and are used for rendering
 * market data in charts and dashboards.
 */

export interface Quote {
  symbol: string;
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
  midPrice: number;
  spread: number;
  microPrice: number;
  imbalance: number;
  ts: number;
  isoTs: string;
}

export interface Trade {
  symbol: string;
  price: number;
  size: number;
  ts: number;
  isoTs: string;
  exchange?: string;
}

export interface Bar {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
  tradeCount?: number;
  ts: number;
  isoTs: string;
  timeframe: string;
}
