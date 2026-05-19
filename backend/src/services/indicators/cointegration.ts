/**
 * services/indicators/cointegration.ts
 *
 * Engle-Granger two-step cointegration test.
 *
 * Step 1: OLS regression of price1 on price2 → collect residuals.
 * Step 2: Dickey-Fuller test on residuals (no intercept, no lags) →
 *         test statistic τ = γ_hat / SE(γ_hat) where γ_hat is the
 *         coefficient from Δe[t] = γ * e[t-1] + noise.
 *
 * Reject non-stationarity (i.e. accept cointegration) when τ is below
 * the MacKinnon (1991) critical value for the chosen significance level.
 *
 * Critical values (bivariate, with intercept in OLS step):
 *   1%  → -3.9001
 *   5%  → -3.3377
 *   10% → -3.0462
 *
 * Inputs:  Two equal-length price arrays (oldest first), significance level.
 * Outputs: EngleGrangerResult or null if insufficient data.
 */

import { computeOLSHedgeRatio } from "./ols";

export interface EngleGrangerResult {
  /** OLS slope — use as hedge ratio */
  beta: number;
  /** OLS intercept */
  alpha: number;
  /** DF test statistic (τ). More negative = stronger evidence of cointegration. */
  testStatistic: number;
  /** MacKinnon critical value for the chosen significance level */
  criticalValue: number;
  /** true when testStatistic < criticalValue (reject unit root) */
  isCointegrated: boolean;
}

// MacKinnon (1991) critical values for 2-variable EG test with intercept
const CRITICAL_VALUES: Record<number, number> = {
  0.01: -3.9001,
  0.05: -3.3377,
  0.10: -3.0462,
};

/**
 * Engle-Granger cointegration test on two price series.
 *
 * Returns null when there are fewer than 5 observations or the OLS step
 * fails (zero-variance leg2).
 */
export function computeEngleGranger(
  price1s: number[],
  price2s: number[],
  significanceLevel: number = 0.05,
): EngleGrangerResult | null {
  const n = price1s.length;
  if (n < 5 || n !== price2s.length) return null;

  const ols = computeOLSHedgeRatio(price1s, price2s);
  if (ols === null) return null;

  // Compute OLS residuals: e[t] = price1[t] - alpha - beta * price2[t]
  const residuals: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    residuals[i] = price1s[i] - ols.alpha - ols.beta * price2s[i];
  }

  // DF test: regress Δe[t] on e[t-1] (no intercept)
  // γ_hat = Σ(e[t-1] * Δe[t]) / Σ(e[t-1]²)
  let numerator = 0;
  let denominator = 0;
  for (let t = 1; t < n; t++) {
    const lagE = residuals[t - 1];
    const deltaE = residuals[t] - residuals[t - 1];
    numerator += lagE * deltaE;
    denominator += lagE * lagE;
  }

  if (denominator === 0) return null;

  const gamma = numerator / denominator;

  // σ² = Σ(Δe[t] - γ_hat * e[t-1])² / (n - 2)
  let sse = 0;
  for (let t = 1; t < n; t++) {
    const lagE = residuals[t - 1];
    const deltaE = residuals[t] - residuals[t - 1];
    const resid = deltaE - gamma * lagE;
    sse += resid * resid;
  }
  const df = n - 2;
  if (df <= 0) return null;

  const sigma2 = sse / df;
  const se = Math.sqrt(sigma2 / denominator);
  if (se === 0) return null;

  const testStatistic = gamma / se;

  const criticalValue = CRITICAL_VALUES[significanceLevel] ?? CRITICAL_VALUES[0.05];

  return {
    beta: ols.beta,
    alpha: ols.alpha,
    testStatistic,
    criticalValue,
    isCointegrated: testStatistic < criticalValue,
  };
}
