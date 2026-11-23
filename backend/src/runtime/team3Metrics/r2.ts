/**
 * runtime/team3Metrics/r2.ts
 *
 * R2 regime: time-stop exits on trend days.
 * Owner: the r2 Stage 2 session (branch team3/r2). Only that session edits this file.
 *
 * Trend day (pre-registered in ledger-r2.md): per symbol-day, the regular-session
 * move |last close - first open| / first open is >= the 75th percentile of that
 * move across all symbol-days in the run's bars. The bars do not depend on the
 * strategy config, so for a fixed universe the threshold equals the baseline's.
 */

import type { MetricInput } from "./trades";
import { inRegularSession, newYorkDay } from "../../strategies/team3Reversal/session";

const TREND_PERCENTILE = 0.75;

/** Linear-interpolated quantile of a sorted array. */
function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const round = (x: number, d = 4): number => (Number.isFinite(x) ? Number(x.toFixed(d)) : x);

export function r2Metrics(input: MetricInput): Record<string, unknown> {
  if (!input.barsBySymbol.size && !input.roundTrips.length) return {}; // nothing to measure
  // Regular-session |close - open| / open per symbol-day.
  const moveByKey = new Map<string, number>();
  for (const [symbol, bars] of input.barsBySymbol) {
    const first = new Map<string, number>(), last = new Map<string, number>();
    for (const b of bars) {
      if (!inRegularSession(b.ts)) continue;
      const day = newYorkDay(b.ts);
      if (!first.has(day)) first.set(day, b.open);
      last.set(day, b.close);
    }
    for (const [day, open] of first) {
      if (open > 0) moveByKey.set(`${symbol}|${day}`, Math.abs(last.get(day)! - open) / open);
    }
  }
  const threshold = quantile([...moveByKey.values()].sort((a, b) => a - b), TREND_PERCENTILE);
  const isTrend = (symbol: string, ts: number): boolean => (moveByKey.get(`${symbol}|${newYorkDay(ts)}`) ?? 0) >= threshold;

  let timeTrend = 0, timeNonTrend = 0, tradesTrend = 0, tradesNonTrend = 0, grossSum = 0;
  for (const rt of input.roundTrips) {
    const trend = isTrend(rt.symbol, rt.entryTs);
    if (trend) tradesTrend++; else tradesNonTrend++;
    if (rt.reason === "time") { if (trend) timeTrend++; else timeNonTrend++; }
    grossSum += rt.pnlBpsGross;
  }
  const n = input.roundTrips.length;
  return {
    trendThresholdPct: round(threshold * 100, 3),
    symbolDays: moveByKey.size,
    trendSymbolDays: [...moveByKey.values()].filter((m) => m >= threshold).length,
    timeStopsTrendDays: timeTrend,
    timeStopsNonTrendDays: timeNonTrend,
    tradesTrendDays: tradesTrend,
    tradesNonTrendDays: tradesNonTrend,
    grossBpsPerTrade: n ? round(grossSum / n, 2) : null,
  };
}
