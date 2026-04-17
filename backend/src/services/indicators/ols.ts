/**
 * services/indicators/ols.ts
 *
 * Ordinary Least Squares (OLS) regression for hedge ratio estimation.
 * Regresses price1 on price2 to find the beta (slope) that minimizes
 * the variance of the spread, producing the most stationary residuals.
 *
 * Used by the pairs trading strategy to compute a data-driven hedge ratio
 * rather than relying on a fixed user-supplied value.
 *
 * Inputs:  Two equal-length price arrays (oldest first).
 * Outputs: { beta, alpha } where beta is the hedge ratio, or null if
 *          insufficient data.
 */

export interface OLSResult {
  /** Slope coefficient — use this as the hedge ratio */
  beta: number;
  /** Intercept — the baseline spread level when price2 = 0 */
  alpha: number;
  /** R-squared — how well price2 explains price1 (0–1) */
  rSquared: number;
}

/**
 * Computes OLS regression of price1 on price2.
 * Finds beta and alpha such that price1 ≈ alpha + beta * price2.
 * Beta minimizes Var(price1 - beta * price2), giving the most stationary spread.
 *
 * Returns null if fewer than 2 observations are provided or if price2 has
 * zero variance (constant series — hedge ratio undefined).
 *
 * @param price1s - Dependent variable (leg1 prices), oldest first
 * @param price2s - Independent variable (leg2 prices), oldest first
 * @returns OLSResult or null
 */
export function computeOLSHedgeRatio(
  price1s: number[],
  price2s: number[],
): OLSResult | null {
  const n = price1s.length;
  if (n < 2 || n !== price2s.length) return null;

  let sum1 = 0;
  let sum2 = 0;
  for (let i = 0; i < n; i++) {
    sum1 += price1s[i];
    sum2 += price2s[i];
  }
  const mean1 = sum1 / n;
  const mean2 = sum2 / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const d1 = price1s[i] - mean1;
    const d2 = price2s[i] - mean2;
    cov  += d2 * d1;
    varX += d2 * d2;
    varY += d1 * d1;
  }

  if (varX === 0) return null;

  const beta  = cov / varX;
  const alpha = mean1 - beta * mean2;
  const rSquared = varY === 0 ? 1 : (cov * cov) / (varX * varY);

  return { beta, alpha, rSquared };
}
