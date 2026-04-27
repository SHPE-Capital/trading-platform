import { computeOLSHedgeRatio } from '../../services/indicators/ols';

describe('computeOLSHedgeRatio', () => {
  it('returns null for fewer than 2 observations', () => {
    expect(computeOLSHedgeRatio([1], [1])).toBeNull();
  });

  it('returns null when arrays have different lengths', () => {
    expect(computeOLSHedgeRatio([1, 2], [1])).toBeNull();
  });

  it('returns null when price2s (x) has zero variance', () => {
    // price2s = [3,3,3] → constant, Var(x)=0 → undefined slope
    expect(computeOLSHedgeRatio([1, 2, 3], [3, 3, 3])).toBeNull();
  });

  it('computes positive beta for perfectly correlated increasing series', () => {
    // price1s = [2,4,6] = 2 * price2s → beta=2
    const result = computeOLSHedgeRatio([2, 4, 6], [1, 2, 3]);
    expect(result).not.toBeNull();
    expect(result!.beta).toBeCloseTo(2.0, 5);
  });

  it('computes negative beta for perfectly inversely correlated series', () => {
    // price1s = [6,4,2] = -2 * price2s + 8 → beta=-2
    const result = computeOLSHedgeRatio([6, 4, 2], [1, 2, 3]);
    expect(result).not.toBeNull();
    expect(result!.beta).toBeCloseTo(-2.0, 5);
  });

  it('rSquared is 1 for a perfect linear relationship', () => {
    const result = computeOLSHedgeRatio([2, 4, 6], [1, 2, 3]);
    expect(result!.rSquared).toBeCloseTo(1.0, 5);
  });

  it('rSquared is between 0 and 1 for imperfect relationship', () => {
    const result = computeOLSHedgeRatio([1, 3, 2, 4], [1, 2, 3, 4]);
    expect(result).not.toBeNull();
    expect(result!.rSquared).toBeGreaterThan(0);
    expect(result!.rSquared).toBeLessThan(1);
  });

  it('computes correct alpha (intercept)', () => {
    // price1 = 1 + 2*price2 → alpha=1, beta=2
    const result = computeOLSHedgeRatio([3, 5, 7], [1, 2, 3]);
    expect(result).not.toBeNull();
    expect(result!.beta).toBeCloseTo(2.0, 5);
    expect(result!.alpha).toBeCloseTo(1.0, 5);
  });

  it('works with two observations', () => {
    const result = computeOLSHedgeRatio([2, 4], [1, 2]);
    expect(result).not.toBeNull();
    expect(result!.beta).toBeCloseTo(2.0, 5);
  });
});
