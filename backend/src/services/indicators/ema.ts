/**
 * services/indicators/ema.ts
 *
 * Exponential Moving Average (EMA) calculation.
 * Stateless pure functions operating on arrays of numbers.
 *
 * Used by momentum, neural network, and market-making strategies.
 *
 * Inputs:  number[] of prices/values, integer period.
 * Outputs: EMA value(s) as number or number[].
 */

/**
 * Computes the Exponential Moving Average for an array of values.
 * Returns an array of the same length as input where the first (period-1)
 * values are the corresponding SMA values (warm-up period).
 *
 * @param values - Array of numeric values (oldest first)
 * @param period - EMA period (number of observations for the smoothing factor)
 * @returns Array of EMA values aligned with input
 */
export function computeEMA(values: number[], period: number): number[] {
  if (values.length === 0 || period <= 0) return [];

  const k = 2 / (period + 1);
  const result: number[] = [];

  // Seed with SMA of the first `period` values
  let seed = 0;
  for (let i = 0; i < Math.min(period, values.length); i++) {
    seed += values[i];
    result.push(i < period - 1 ? NaN : seed / period);
  }

  // Continue with EMA formula for remaining values
  for (let i = period; i < values.length; i++) {
    const prev = result[i - 1];
    result.push(values[i] * k + prev * (1 - k));
  }

  return result;
}

/**
 * Computes a single EMA value given the previous EMA and a new data point.
 * Use this for incremental real-time updates (more efficient than full array).
 *
 * @param newValue - Latest observation
 * @param prevEMA - Previous EMA value
 * @param period - EMA period
 * @returns New EMA value
 */
export function updateEMA(newValue: number, prevEMA: number, period: number): number {
  const k = 2 / (period + 1);
  return newValue * k + prevEMA * (1 - k);
}

/**
 * Returns the latest (most recent) EMA value for an array.
 * Returns NaN if there are fewer values than the period.
 *
 * @param values - Array of numeric values (oldest first)
 * @param period - EMA period
 * @returns Latest EMA value or NaN
 */
export function latestEMA(values: number[], period: number): number {
  const emas = computeEMA(values, period);
  return emas[emas.length - 1] ?? NaN;
}
