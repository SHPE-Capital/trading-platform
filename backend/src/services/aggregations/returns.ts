/**
 * services/aggregations/returns.ts
 *
 * Return calculation utilities: simple returns, log returns, and
 * cumulative returns from price series or equity curves.
 *
 * Inputs:  number[] of prices or equity values.
 * Outputs: number[] of return values or single cumulative return.
 */

/**
 * Computes simple (arithmetic) percentage returns from a price series.
 * return[i] = (price[i] - price[i-1]) / price[i-1]
 *
 * @param prices - Array of prices (oldest first)
 * @returns Array of simple returns (length = prices.length - 1)
 */
export function computeSimpleReturns(prices: number[]): number[] {
  if (prices.length < 2) return [];
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] !== 0) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
  }
  return returns;
}

/**
 * Computes log (continuously compounded) returns from a price series.
 * return[i] = ln(price[i] / price[i-1])
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
 * Computes the total cumulative return from a price series.
 * result = (prices[last] - prices[0]) / prices[0]
 *
 * @param prices - Array of prices (oldest first)
 * @returns Cumulative return as a decimal fraction, or 0 if insufficient data
 */
export function computeCumulativeReturn(prices: number[]): number {
  if (prices.length < 2 || prices[0] === 0) return 0;
  return (prices[prices.length - 1] - prices[0]) / prices[0];
}

/**
 * Computes the cumulative equity curve from a series of simple returns.
 * Starting from initialEquity, applies each return multiplicatively.
 *
 * @param returns - Array of simple returns (as decimal fractions)
 * @param initialEquity - Starting equity value (default 1.0 for normalized curve)
 * @returns Array of equity values aligned with returns + initial value at index 0
 */
export function computeEquityCurve(returns: number[], initialEquity = 1.0): number[] {
  const curve: number[] = [initialEquity];
  let equity = initialEquity;
  for (const r of returns) {
    equity *= 1 + r;
    curve.push(equity);
  }
  return curve;
}
