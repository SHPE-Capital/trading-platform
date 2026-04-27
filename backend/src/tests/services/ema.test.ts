import { computeEMA, updateEMA, latestEMA } from '../../services/indicators/ema';

describe('computeEMA', () => {
  it('returns [] for an empty input', () => {
    expect(computeEMA([], 5)).toEqual([]);
  });

  it('returns [] for a non-positive period', () => {
    expect(computeEMA([1, 2, 3], 0)).toEqual([]);
  });

  it('warm-up values are NaN for the first (period-1) indices', () => {
    const result = computeEMA([1, 2, 3, 4, 5], 3);
    expect(isNaN(result[0])).toBe(true);
    expect(isNaN(result[1])).toBe(true);
    expect(isNaN(result[2])).toBe(false);
  });

  it('seeds with SMA for the first valid index', () => {
    // period=3, seed = (1+2+3)/3 = 2
    const result = computeEMA([1, 2, 3, 4, 5], 3);
    expect(result[2]).toBeCloseTo(2.0, 5);
  });

  it('applies EMA formula after the seed value', () => {
    // k = 2/(3+1) = 0.5
    // index 3: 4*0.5 + 2.0*0.5 = 3.0
    // index 4: 5*0.5 + 3.0*0.5 = 4.0
    const result = computeEMA([1, 2, 3, 4, 5], 3);
    expect(result[3]).toBeCloseTo(3.0, 5);
    expect(result[4]).toBeCloseTo(4.0, 5);
  });

  it('returns a result array of the same length as input', () => {
    expect(computeEMA([10, 20, 30, 40, 50], 3)).toHaveLength(5);
  });

  it('handles input shorter than period — all NaN except last', () => {
    const result = computeEMA([5, 10], 5);
    expect(isNaN(result[0])).toBe(true);
    expect(isNaN(result[1])).toBe(true);
  });

  it('handles period=1 — every value equals the input', () => {
    const result = computeEMA([10, 20, 30], 1);
    // k = 2/(1+1) = 1, so EMA[i] = value[i]*1 + prev*0 = value[i]
    expect(result[0]).toBeCloseTo(10, 5);
    expect(result[1]).toBeCloseTo(20, 5);
    expect(result[2]).toBeCloseTo(30, 5);
  });
});

describe('updateEMA', () => {
  it('applies the incremental EMA formula', () => {
    // k = 2/(10+1) ≈ 0.1818
    const k = 2 / 11;
    const expected = 100 * k + 90 * (1 - k);
    expect(updateEMA(100, 90, 10)).toBeCloseTo(expected, 5);
  });

  it('returns newValue when prevEMA is 0 and period=1', () => {
    expect(updateEMA(50, 0, 1)).toBeCloseTo(50, 5);
  });
});

describe('latestEMA', () => {
  it('returns the last EMA value in the series', () => {
    // period=3: last EMA of [1,2,3,4,5] = 4.0
    expect(latestEMA([1, 2, 3, 4, 5], 3)).toBeCloseTo(4.0, 5);
  });

  it('returns NaN when input is shorter than the period', () => {
    expect(isNaN(latestEMA([1, 2], 5))).toBe(true);
  });

  it('returns NaN for empty input', () => {
    expect(isNaN(latestEMA([], 3))).toBe(true);
  });
});
