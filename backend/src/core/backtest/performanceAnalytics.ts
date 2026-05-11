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
 *   - Period returns are simple returns from one equity snapshot to the next.
 *   - Annualization uses calendar days from periodStart to periodEnd. For
 *     intraday backtests the equity curve cadence is faster than calendar
 *     days but we still report annualized values keyed to wall-clock time.
 *     The ratios approach a daily-resampled equivalent in the limit and are
 *     directly comparable across backtests of similar duration.
 *   - When variance is effectively zero or the series is too short
 *     (fewer than `MIN_PERIODS_FOR_RATIOS` samples), the corresponding ratio
 *     is omitted (undefined) rather than reported as Infinity/NaN.
 */

import type { PortfolioSnapshot } from "../../types/portfolio";

const MIN_PERIODS_FOR_RATIOS = 4;
const MS_PER_YEAR = 365.25 * 24 * 3_600_000;
const VARIANCE_EPS = 1e-12;

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
  const periodCount = Math.max(0, equityCurve.length - 1);

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

  if (periodCount < MIN_PERIODS_FOR_RATIOS) {
    return {
      profitFactor,
      riskFreeRateAnnual,
      periodCount,
      benchmarkReturn,
    };
  }

  // Build period returns from equity values.
  const equities = equityCurve.map((s) => s.equity);
  const returns: number[] = [];
  for (let i = 1; i < equities.length; i++) {
    const prev = equities[i - 1];
    if (prev > 0 && Number.isFinite(prev) && Number.isFinite(equities[i])) {
      returns.push(equities[i] / prev - 1);
    }
  }

  if (returns.length < MIN_PERIODS_FOR_RATIOS) {
    return { profitFactor, riskFreeRateAnnual, periodCount, benchmarkReturn };
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

  // Annualization factor: returns per year, derived from the wall-clock span.
  const spanMs = Math.max(1, periodEnd - periodStart);
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
  let peak = equities[0];
  let maxDrawdown = 0;
  for (const e of equities) {
    if (e > peak) peak = e;
    if (peak > 0) {
      const dd = (peak - e) / peak;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  }
  const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : undefined;

  return {
    annualizedReturn,
    annualizedVol,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    profitFactor,
    riskFreeRateAnnual,
    periodCount,
    benchmarkReturn,
  };
}
