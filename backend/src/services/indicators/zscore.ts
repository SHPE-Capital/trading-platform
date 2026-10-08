/**
 * services/indicators/zscore.ts
 *
 * Z-score calculation. Given an array of values, computes the rolling
 * mean and standard deviation and returns the z-score of the last value.
 *
 * Used by the pairs trading strategy to detect spread deviations.
 *
 * Inputs:  number[] — array of values (spread observations, prices, etc.)
 * Outputs: { zScore, mean, std } or null if insufficient data.
 */

/** Result of a z-score computation */
export interface ZScoreResult {
  /** The z-score of the last value: (last - mean) / std */
  zScore: number;
  /** Arithmetic mean of the input array */
  mean: number;
  /** Sample standard deviation of the input array */
  std: number;
  /** The value that was scored (last element of input) */
  value: number;
}

/**
 * Computes the z-score of the last element relative to the sample distribution.
 * Returns null if fewer than 2 values are provided (can't compute std dev).
 *
 * @param values - Array of numeric observations (oldest first)
 * @returns ZScoreResult or null if insufficient data
 */
export function computeZScore(values: number[]): ZScoreResult | null {
  if (values.length < 2) return null;

  const mean = computeMean(values);
  const std = computeStdDev(values, mean);

  if (std === 0) return { zScore: 0, mean, std: 0, value: values[values.length - 1] };

  const value = values[values.length - 1];
  const zScore = (value - mean) / std;

  return { zScore, mean, std, value };
}

/**
 * Computes a z-score from pre-computed distribution statistics.
 *
 * Companion to computeZScore for callers that already maintain a running mean
 * and standard deviation — RollingNumericWindow keeps both incrementally, so
 * rescanning the window just to score one value would be wasted work.
 *
 * A zero standard deviation means every observation is identical, so the value
 * sits exactly at the mean by definition and scores 0 rather than dividing by zero.
 *
 * @param value - The observation to score
 * @param mean - Mean of the distribution
 * @param std - Sample standard deviation of the distribution
 * @returns ZScoreResult carrying the score and the inputs used
 */
export function computeZScoreFromStats(
  value: number,
  mean: number,
  std: number,
): ZScoreResult {
  return {
    zScore: std === 0 ? 0 : (value - mean) / std,
    mean,
    std,
    value,
  };
}

/**
 * Computes the arithmetic mean of an array of numbers.
 * @param values - Input array
 * @returns Mean value
 */
export function computeMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Computes the sample standard deviation (denominator = n-1) of an array.
 * @param values - Input array
 * @param mean - Pre-computed mean (optional; recomputed if not provided)
 * @returns Sample standard deviation
 */
export function computeStdDev(values: number[], mean?: number): number {
  if (values.length < 2) return 0;
  const m = mean ?? computeMean(values);
  const variance =
    values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}
