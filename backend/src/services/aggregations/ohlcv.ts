/**
 * services/aggregations/ohlcv.ts
 *
 * OHLCV bar aggregation from raw tick/trade data.
 * Builds candlestick bars from arrays of trades, useful when
 * building custom timeframes or aggregating tick data in backtest mode.
 *
 * Inputs:  Trade[] array within a time period.
 * Outputs: Bar object representing the OHLCV for that period.
 */

import type { Trade, Bar } from "../../types/market";
import { msToIso } from "../../utils/time";

/**
 * Aggregates an array of trades into a single OHLCV bar.
 * Assumes all trades belong to the same symbol and time period.
 *
 * @param trades - Array of Trade objects for the period (oldest first)
 * @param symbol - Ticker symbol for the bar
 * @param periodStartMs - Period start timestamp (Unix ms)
 * @param timeframe - Timeframe label (e.g. "1m", "5m")
 * @returns Bar object or null if trades array is empty
 */
export function aggregateTradesToBar(
  trades: Trade[],
  symbol: string,
  periodStartMs: number,
  timeframe: string,
): Bar | null {
  if (trades.length === 0) return null;

  let open = trades[0].price;
  let high = trades[0].price;
  let low = trades[0].price;
  let close = trades[trades.length - 1].price;
  let volume = 0;
  let vwapNumerator = 0;

  for (const trade of trades) {
    if (trade.price > high) high = trade.price;
    if (trade.price < low) low = trade.price;
    volume += trade.size;
    vwapNumerator += trade.price * trade.size;
  }

  const vwap = volume > 0 ? vwapNumerator / volume : close;

  return {
    symbol,
    open,
    high,
    low,
    close,
    volume,
    vwap,
    tradeCount: trades.length,
    ts: periodStartMs,
    isoTs: msToIso(periodStartMs),
    timeframe,
  };
}

/**
 * Groups a flat trade array into OHLCV bars of a fixed duration.
 *
 * @param trades - Array of Trade objects (must be sorted by ts ascending)
 * @param symbol - Ticker symbol
 * @param periodMs - Bar duration in milliseconds (e.g. 60000 for 1m)
 * @param timeframe - Timeframe label
 * @returns Array of Bar objects sorted by ts ascending
 */
export function groupTradesToBars(
  trades: Trade[],
  symbol: string,
  periodMs: number,
  timeframe: string,
): Bar[] {
  if (trades.length === 0) return [];

  const bars: Bar[] = [];
  const firstTs = trades[0].ts;
  let currentPeriodStart = firstTs - (firstTs % periodMs);
  let currentBatch: Trade[] = [];

  for (const trade of trades) {
    const tradePeriod = trade.ts - (trade.ts % periodMs);
    if (tradePeriod !== currentPeriodStart) {
      const bar = aggregateTradesToBar(currentBatch, symbol, currentPeriodStart, timeframe);
      if (bar) bars.push(bar);
      currentPeriodStart = tradePeriod;
      currentBatch = [];
    }
    currentBatch.push(trade);
  }

  // Flush the last batch
  const bar = aggregateTradesToBar(currentBatch, symbol, currentPeriodStart, timeframe);
  if (bar) bars.push(bar);

  return bars;
}
