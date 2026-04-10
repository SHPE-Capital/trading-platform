/**
 * services/indicators/sma.ts
 *
 * Simple Moving Average (SMA) calculation.
 * Stateless pure functions operating on arrays of numbers.
 *
 * Inputs:  number[] of prices/values, integer period.
 * Outputs: SMA value(s) as number or number[].
 */

/**
 * Computes the full SMA series for an array of values.
 * The first (period-1) output values are NaN (insufficient data).
 *
 * @param values - Array of numeric values (oldest first)
 * @param period - SMA period (window size)
 * @returns Array of SMA values aligned with input
 */
export function computeSMA(values: number[], period: number): number[] {
  if (values.length === 0 || period <= 0) return [];

  const result: number[] = [];
  let windowSum = 0;

  for (let i = 0; i < values.length; i++) {
    windowSum += values[i];
    if (i >= period) windowSum -= values[i - period];
    result.push(i < period - 1 ? NaN : windowSum / period);
  }

  return result;
}

/**
 * Returns the latest (most recent) SMA value for an array.
 * Returns NaN if there are fewer values than the period.
 *
 * @param values - Array of numeric values (oldest first)
 * @param period - SMA period
 * @returns Latest SMA value or NaN
 */
export function latestSMA(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const slice = values.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}
