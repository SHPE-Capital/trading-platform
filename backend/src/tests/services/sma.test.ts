import { computeSMA, latestSMA } from '../../services/indicators/sma';

describe('computeSMA', () => {
  it('returns [] for empty input', () => {
    expect(computeSMA([], 3)).toEqual([]);
  });

  it('returns [] for non-positive period', () => {
    expect(computeSMA([1, 2, 3], 0)).toEqual([]);
  });

  it('first (period-1) entries are NaN', () => {
    const result = computeSMA([1, 2, 3, 4, 5], 3);
    expect(isNaN(result[0])).toBe(true);
    expect(isNaN(result[1])).toBe(true);
    expect(isNaN(result[2])).toBe(false);
  });

  it('computes correct SMA values after warm-up', () => {
    // period=3: SMA[2]=(1+2+3)/3=2, SMA[3]=(2+3+4)/3=3, SMA[4]=(3+4+5)/3=4
    const result = computeSMA([1, 2, 3, 4, 5], 3);
    expect(result[2]).toBeCloseTo(2, 5);
    expect(result[3]).toBeCloseTo(3, 5);
    expect(result[4]).toBeCloseTo(4, 5);
  });

  it('returns array of the same length as input', () => {
    expect(computeSMA([10, 20, 30, 40], 2)).toHaveLength(4);
  });

  it('period=1 — every value equals input', () => {
    const result = computeSMA([5, 10, 15], 1);
    expect(result[0]).toBe(5);
    expect(result[1]).toBe(10);
    expect(result[2]).toBe(15);
  });
});

describe('latestSMA', () => {
  it('returns the average of the last N values', () => {
    // last 3 of [1,2,3,4,5] = (3+4+5)/3 = 4
    expect(latestSMA([1, 2, 3, 4, 5], 3)).toBeCloseTo(4, 5);
  });

  it('returns NaN when input has fewer values than period', () => {
    expect(isNaN(latestSMA([1, 2], 5))).toBe(true);
  });

  it('returns the single value when period equals array length', () => {
    expect(latestSMA([100], 1)).toBe(100);
  });
});
