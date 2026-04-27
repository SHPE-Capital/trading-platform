import {
  computeLogReturns,
  computeRealizedVolatility,
  computeAnnualizedVolatility,
  computeReturnVariance,
} from '../../services/indicators/volatility';

describe('computeLogReturns', () => {
  it('returns [] for fewer than 2 prices', () => {
    expect(computeLogReturns([])).toEqual([]);
    expect(computeLogReturns([100])).toEqual([]);
  });

  it('computes log returns correctly', () => {
    const returns = computeLogReturns([100, 110]);
    expect(returns).toHaveLength(1);
    expect(returns[0]).toBeCloseTo(Math.log(110 / 100), 8);
  });

  it('skips a return when the previous price is 0 or negative', () => {
    const returns = computeLogReturns([0, 100, 110]);
    expect(returns).toHaveLength(1); // only ln(110/100)
  });

  it('returns length is prices.length - 1', () => {
    expect(computeLogReturns([1, 2, 3, 4, 5])).toHaveLength(4);
  });
});

describe('computeRealizedVolatility', () => {
  it('returns null for fewer than 3 prices (need ≥2 returns)', () => {
    expect(computeRealizedVolatility([])).toBeNull();
    expect(computeRealizedVolatility([100])).toBeNull();
    expect(computeRealizedVolatility([100, 110])).toBeNull(); // only 1 return → std needs ≥2
  });

  it('returns 0 for constant prices (all log returns are 0)', () => {
    expect(computeRealizedVolatility([100, 100, 100])).toBe(0);
  });

  it('returns 0 for geometrically constant price changes (identical log returns)', () => {
    // 100 → 110 → 121: both log returns are ln(1.1), std=0
    expect(computeRealizedVolatility([100, 110, 121])).toBe(0);
  });

  it('returns a positive value for varying prices', () => {
    const vol = computeRealizedVolatility([100, 110, 99, 105, 98]);
    expect(vol).not.toBeNull();
    expect(vol!).toBeGreaterThan(0);
  });
});

describe('computeAnnualizedVolatility', () => {
  it('returns null when there are insufficient prices', () => {
    expect(computeAnnualizedVolatility([100, 110])).toBeNull();
  });

  it('is rawVol × sqrt(periodsPerYear)', () => {
    const prices = [100, 110, 99, 105, 98];
    const rawVol = computeRealizedVolatility(prices)!;
    const annualized = computeAnnualizedVolatility(prices, 252);
    expect(annualized).toBeCloseTo(rawVol * Math.sqrt(252), 8);
  });

  it('uses 252 as the default periodsPerYear', () => {
    const prices = [100, 105, 102, 108, 103];
    const explicit = computeAnnualizedVolatility(prices, 252);
    const defaultPeriod = computeAnnualizedVolatility(prices);
    expect(explicit).toBe(defaultPeriod);
  });
});

describe('computeReturnVariance', () => {
  it('returns null when there are insufficient prices', () => {
    expect(computeReturnVariance([100, 110])).toBeNull();
  });

  it('equals rawVol squared', () => {
    const prices = [100, 110, 99, 105];
    const rawVol = computeRealizedVolatility(prices)!;
    const variance = computeReturnVariance(prices);
    expect(variance).toBeCloseTo(rawVol * rawVol, 10);
  });

  it('returns 0 for constant prices', () => {
    expect(computeReturnVariance([100, 100, 100, 100])).toBe(0);
  });
});
