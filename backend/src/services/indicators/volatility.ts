/**
 * services/indicators/volatility.ts
 *
 * Rolling realized volatility calculations.
 * Computes annualized and per-period volatility from return series.
 *
 * Used by market-making strategy (sigma² input to A-S model),
 * and optionally by neural network features.
 *
 * Inputs:  number[] of prices or returns, integer period, trading days per year.
 * Outputs: Volatility as a decimal fraction (annualized or raw).
 */

import { computeStdDev } from "./zscore";

/** Number of trading days in a year (standard US equities) */
const TRADING_DAYS_PER_YEAR = 252;

/**
 * Computes log returns from a price series.
 * Log return at index i = ln(price[i] / price[i-1]).
 *
 * @param prices - Array of prices (oldest first)
 * @returns Array of log returns (length = prices.length - 1)
 */
export function computeLogReturns(prices: number[]): number[] {
  if (prices.length < 2) return [];
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }
  return returns;
}

/**
 * Computes the realized volatility (standard deviation of log returns).
 * Returns raw (un-annualized) volatility.
 *
 * @param prices - Array of prices (oldest first), at least 3 values needed
 * @returns Raw realized volatility or null if insufficient data
 */
export function computeRealizedVolatility(prices: number[]): number | null {
  const returns = computeLogReturns(prices);
  if (returns.length < 2) return null;
  return computeStdDev(returns);
}

/**
 * Computes annualized realized volatility from a price series.
 * Annualized vol = raw_vol × sqrt(periodsPerYear).
 *
 * @param prices - Array of prices (oldest first)
 * @param periodsPerYear - How many bars/periods make up a year (default 252 for daily bars)
 * @returns Annualized volatility or null if insufficient data
 */
export function computeAnnualizedVolatility(
  prices: number[],
  periodsPerYear = TRADING_DAYS_PER_YEAR,
): number | null {
  const rawVol = computeRealizedVolatility(prices);
  if (rawVol === null) return null;
  return rawVol * Math.sqrt(periodsPerYear);
}

/**
 * Computes the variance of log returns (useful for the A-S market-making model).
 *
 * @param prices - Array of prices (oldest first)
 * @returns Variance of log returns or null if insufficient data
 */
export function computeReturnVariance(prices: number[]): number | null {
  const rawVol = computeRealizedVolatility(prices);
  if (rawVol === null) return null;
  return rawVol * rawVol;
}
