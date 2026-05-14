/**
 * core/backtest/performanceAnalytics.ts
 *
 * Computes risk-adjusted return metrics from a backtest's equity curve and
 * trade list (Sharpe, Sortino, Calmar, profit factor, annualized return/vol).
 *
 * Inputs:
 *   - equity curve (PortfolioSnapshot[]) — used to derive period returns
 *   - per-trade PnL series — used for profit factor / trade-level metrics
 *   - run period [periodStart, periodEnd] in epoch ms
 *   - optional risk-free rate (annualized fraction, default 0)
 *   - optional benchmark equity curve — when provided, alpha/beta-style stats
 *     may be reported alongside the strategy ratios (currently we just expose
 *     benchmarkReturn so the frontend can render a comparison)
 *
 * Outputs:
 *   - AnalyticsResult with all available ratios. Missing/undefined fields
 *     denote insufficient data (e.g. equity curve < 2 points, zero variance).
 *
 * Numerical conventions:
 *   - The equity curve is resampled to daily observations (last equity per
 *     calendar day) before computing returns. This matches the industry-standard
 *     daily Sharpe convention and prevents near-zero variance for market-neutral
 *     strategies (e.g. pairs trading) whose per-bar equity is flat between trades.
 *   - Annualization uses the simulated backtest period (periodStart/periodEnd),
 *     not wall-clock engine time, so periodsPerYear ≈ 252 for a one-year run.
 *   - When variance is effectively zero or the series is too short
 *     (fewer than `MIN_PERIODS_FOR_RATIOS` daily samples), the corresponding ratio
 *     is omitted (undefined) rather than reported as Infinity/NaN.
 */

import type { PortfolioSnapshot } from "../../types/portfolio";

const MIN_PERIODS_FOR_RATIOS = 4;
const MS_PER_YEAR = 365.25 * 24 * 3_600_000;
const MS_PER_DAY = 24 * 3_600_000;
const VARIANCE_EPS = 1e-12;

/**
 * Resample an equity curve to one return observation per calendar day.
 * Uses the last equity snapshot of each day so intraday noise from
 * market-neutral strategies (e.g. pairs trading with near-zero net exposure)
 * does not inflate the period count or drive stdev toward zero.
 */
function _dailyReturns(equityCurve: PortfolioSnapshot[]): number[] {
  if (equityCurve.length < 2) return [];
  const byDay = new Map<number, number>();
  for (const snap of equityCurve) {
    byDay.set(Math.floor(snap.ts / MS_PER_DAY), snap.equity);
  }
  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  const equities = days.map(([, e]) => e);
  const returns: number[] = [];
  for (let i = 1; i < equities.length; i++) {
    const prev = equities[i - 1];
    if (prev > 0 && Number.isFinite(prev) && Number.isFinite(equities[i])) {
      returns.push(equities[i] / prev - 1);
    }
  }
  return returns;
}

/**
 * Build simple period returns directly from consecutive equity snapshots.
 * Appropriate for intraday/HFT strategies (e.g. Avellaneda-Stoikov) where
 * the relevant risk unit is the bar interval, not the calendar day.
 */
function _perBarReturns(equityCurve: PortfolioSnapshot[]): number[] {
  if (equityCurve.length < 2) return [];
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    const cur = equityCurve[i].equity;
    if (prev > 0 && Number.isFinite(prev) && Number.isFinite(cur)) {
      returns.push(cur / prev - 1);
    }
  }
  return returns;
}

/**
 * Core Sharpe/Sortino computation for any return series.
 * Returns undefined for each ratio when variance is effectively zero
 * or when the series is too short. Used for both daily and per-bar paths.
 */
function _computeRatioStats(
  returns: number[],
  spanMs: number,
  riskFreeRateAnnual: number,
): { sharpeRatio: number | undefined; sortinoRatio: number | undefined } {
  if (returns.length < MIN_PERIODS_FOR_RATIOS) {
    return { sharpeRatio: undefined, sortinoRatio: undefined };
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  const stdev = Math.sqrt(Math.max(0, variance));

  const downside = returns.filter((r) => r < 0);
  const downsideVariance =
    downside.length > 1
      ? downside.reduce((acc, r) => acc + r ** 2, 0) / (downside.length - 1)
      : 0;
  const downsideStdev = Math.sqrt(Math.max(0, downsideVariance));

  const periodsPerYear = (returns.length * MS_PER_YEAR) / spanMs;
  const annualizedReturn = (1 + mean) ** periodsPerYear - 1;
  const annualizedVol = stdev * Math.sqrt(periodsPerYear);
  const excessAnnual = annualizedReturn - riskFreeRateAnnual;

  const sharpeRatio = stdev > Math.sqrt(VARIANCE_EPS) ? excessAnnual / annualizedVol : undefined;
  const annualizedDownsideVol = downsideStdev * Math.sqrt(periodsPerYear);
  const sortinoRatio =
    downsideStdev > Math.sqrt(VARIANCE_EPS) ? excessAnnual / annualizedDownsideVol : undefined;

  return { sharpeRatio, sortinoRatio };
}

/** Result returned by `computeAnalytics`. */
export interface AnalyticsResult {
  /** Annualized return as a fraction; undefined if period is too short. */
  annualizedReturn?: number;
  /** Annualized volatility (stdev of period returns, annualized). */
  annualizedVol?: number;
  /** Sharpe ratio (annualized). Undefined if variance ≈ 0 or series too short. */
  sharpeRatio?: number;
  /** Sortino ratio (annualized, only downside deviation). */
  sortinoRatio?: number;
  /** Calmar ratio = annualizedReturn / maxDrawdown. Undefined if drawdown is 0. */
  calmarRatio?: number;
  /** Gross profit / gross loss across the trade series. Undefined if no losers. */
  profitFactor?: number;
  /** Echoed for the result. */
  riskFreeRateAnnual: number;
  /** Number of return periods used in the computation. */
  periodCount: number;
  /** Optional benchmark return for the same period (fraction). */
  benchmarkReturn?: number;
  /**
   * Per-bar Sharpe ratio (annualized). Preferred for intraday/HFT strategies
   * such as Avellaneda-Stoikov market making, where the relevant risk unit is
   * the bar interval rather than the calendar day.
   */
  intradaySharpeRatio?: number;
  /**
   * Per-bar Sortino ratio (annualized). Preferred for intraday/HFT strategies.
   */
  intradaySortinoRatio?: number;
}

/**
 * Compute analytics for an equity curve.
 *
 * @param equityCurve - One PortfolioSnapshot per period (chronologically ordered).
 * @param tradePnls - Realized PnL per closed-trade slice (signed).
 * @param periodStart - Start of the backtest period (epoch ms).
 * @param periodEnd - End of the backtest period (epoch ms).
 * @param riskFreeRateAnnual - Annualized risk-free rate as a fraction (default 0).
 * @param benchmarkCurve - Optional benchmark equity curve aligned to `equityCurve`'s
 *                         first/last snapshots; only the start/end are used to
 *                         compute the benchmark return.
 */
export function computeAnalytics(
  equityCurve: PortfolioSnapshot[],
  tradePnls: number[],
  periodStart: number,
  periodEnd: number,
  riskFreeRateAnnual = 0,
  benchmarkCurve?: { ts: number; value: number }[],
): AnalyticsResult {
  // Profit factor — defined whenever there are wins AND losses.
  const grossProfit = tradePnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = tradePnls.filter((p) => p < 0).reduce((a, b) => a + Math.abs(b), 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : undefined;

  // Benchmark return — purely directional (last/first - 1). We deliberately
  // do not invent a curve when none is supplied.
  let benchmarkReturn: number | undefined;
  if (benchmarkCurve && benchmarkCurve.length >= 2) {
    const first = benchmarkCurve[0].value;
    const last = benchmarkCurve[benchmarkCurve.length - 1].value;
    if (first > 0 && Number.isFinite(first) && Number.isFinite(last)) {
      benchmarkReturn = last / first - 1;
    }
  }

  const spanMs = Math.max(1, periodEnd - periodStart);

  // Per-bar ratios — computed unconditionally so they are always available
  // for intraday/HFT strategies (Avellaneda-Stoikov, etc.) even when daily
  // sampling would produce too few observations.
  const barReturns = _perBarReturns(equityCurve);
  const { sharpeRatio: intradaySharpeRatio, sortinoRatio: intradaySortinoRatio } =
    _computeRatioStats(barReturns, spanMs, riskFreeRateAnnual);

  // Resample to daily returns. This eliminates near-zero stdev for market-neutral
  // strategies (e.g. pairs trading) where per-bar equity is nearly flat between
  // trades, and makes Sharpe/Sortino comparable to the industry-standard daily convention.
  const returns = _dailyReturns(equityCurve);
  const periodCount = returns.length;

  if (periodCount < MIN_PERIODS_FOR_RATIOS) {
    return { profitFactor, riskFreeRateAnnual, periodCount, benchmarkReturn, intradaySharpeRatio, intradaySortinoRatio };
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  const stdev = Math.sqrt(Math.max(0, variance));

  // Downside-only stdev for Sortino (relative to 0 target as is convention).
  const downside = returns.filter((r) => r < 0);
  const downsideVariance =
    downside.length > 1
      ? downside.reduce((acc, r) => acc + r ** 2, 0) / (downside.length - 1)
      : 0;
  const downsideStdev = Math.sqrt(Math.max(0, downsideVariance));

  // Annualization factor: daily returns per year from the simulated period span.
  const periodsPerYear = (returns.length * MS_PER_YEAR) / spanMs;

  const annualizedReturn = (1 + mean) ** periodsPerYear - 1;
  const annualizedVol = stdev * Math.sqrt(periodsPerYear);

  const excessAnnual = annualizedReturn - riskFreeRateAnnual;
  const sharpeRatio =
    stdev > Math.sqrt(VARIANCE_EPS) ? excessAnnual / annualizedVol : undefined;
  const annualizedDownsideVol = downsideStdev * Math.sqrt(periodsPerYear);
  const sortinoRatio =
    downsideStdev > Math.sqrt(VARIANCE_EPS) ? excessAnnual / annualizedDownsideVol : undefined;

  // Calmar: annualized return / max drawdown (positive fraction).
  let peak = equityCurve[0].equity;
  let maxDrawdown = 0;
  for (const snap of equityCurve) {
    if (snap.equity > peak) peak = snap.equity;
    if (peak > 0) {
      const dd = (peak - snap.equity) / peak;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  }
  const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : undefined;

  return {
    annualizedReturn,
    annualizedVol,
    sharpeRatio,
    sortinoRatio,
    intradaySharpeRatio,
    intradaySortinoRatio,
    calmarRatio,
    profitFactor,
    riskFreeRateAnnual,
    periodCount,
    benchmarkReturn,
  };
}
