/**
 * services/indicators/rsi.ts
 *
 * Relative Strength Index (RSI) calculation.
 * Uses the Wilder smoothing method (standard RSI definition).
 *
 * Inputs:  number[] of closing prices (oldest first), integer period (default 14).
 * Outputs: RSI value in range [0, 100], or null if insufficient data.
 */

/**
 * Computes the RSI for a price series using Wilder's smoothing.
 * Returns the most recent RSI value.
 *
 * @param prices - Array of closing prices (oldest first)
 * @param period - RSI period (default 14)
 * @returns RSI value [0, 100] or null if insufficient data
 */
export function computeRSI(prices: number[], period = 14): number | null {
  if (prices.length <= period) return null;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average gain/loss over first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder smoothing for remaining prices
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
