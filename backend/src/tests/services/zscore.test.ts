import { computeZScore, computeMean, computeStdDev } from '../../services/indicators/zscore';

describe('computeZScore', () => {
  it('returns null when fewer than 2 values', () => {
    expect(computeZScore([5])).toBeNull();
    expect(computeZScore([])).toBeNull();
  });

  it('returns zScore=0 when std is 0 (all same values)', () => {
    const result = computeZScore([3, 3, 3]);
    expect(result).not.toBeNull();
    expect(result!.zScore).toBe(0);
    expect(result!.std).toBe(0);
  });

  it('computes correct z-score for last value', () => {
    // mean=3, sample std=sqrt(2.5)≈1.5811, last=5 → z=(5-3)/1.5811≈1.265
    const result = computeZScore([1, 2, 3, 4, 5]);
    expect(result).not.toBeNull();
    expect(result!.zScore).toBeCloseTo(1.265, 2);
  });

  it('returns the scored value in result.value', () => {
    const result = computeZScore([1, 2, 3, 4, 5]);
    expect(result!.value).toBe(5);
  });

  it('two values gives a non-null result', () => {
    expect(computeZScore([0, 1])).not.toBeNull();
  });
});

describe('computeMean', () => {
  it('returns correct mean', () => {
    expect(computeMean([1, 2, 3])).toBe(2);
  });

  it('returns 0 for empty array', () => {
    expect(computeMean([])).toBe(0);
  });

  it('single value returns that value', () => {
    expect(computeMean([7])).toBe(7);
  });
});

describe('computeStdDev', () => {
  it('returns 0 for fewer than 2 values', () => {
    expect(computeStdDev([5])).toBe(0);
    expect(computeStdDev([])).toBe(0);
  });

  it('computes sample std dev (denominator n-1)', () => {
    // [2,4,4,4,5,5,7,9] → mean=5, sum sq dev=32, sample var=32/7, std≈2.138
    expect(computeStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });

  it('returns 0 for constant series', () => {
    expect(computeStdDev([3, 3, 3])).toBe(0);
  });

  it('accepts pre-computed mean to avoid recalculation', () => {
    const values = [1, 2, 3];
    const mean = computeMean(values);
    expect(computeStdDev(values, mean)).toBeCloseTo(computeStdDev(values), 10);
  });
});
