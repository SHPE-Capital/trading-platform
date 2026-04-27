import {
  computeSimpleReturns,
  computeLogReturns,
  computeCumulativeReturn,
  computeEquityCurve,
} from '../../services/aggregations/returns';

describe('computeSimpleReturns', () => {
  it('returns [] for fewer than 2 prices', () => {
    expect(computeSimpleReturns([])).toEqual([]);
    expect(computeSimpleReturns([100])).toEqual([]);
  });

  it('computes (price[i] - price[i-1]) / price[i-1]', () => {
    const returns = computeSimpleReturns([100, 110, 99]);
    expect(returns[0]).toBeCloseTo(0.1, 5);
    expect(returns[1]).toBeCloseTo(-11 / 110, 5);
  });

  it('returns length is prices.length - 1', () => {
    expect(computeSimpleReturns([10, 20, 30, 40])).toHaveLength(3);
  });

  it('skips the return when the previous price is 0', () => {
    const returns = computeSimpleReturns([0, 100, 110]);
    expect(returns).toHaveLength(1); // only (110-100)/100
  });
});

describe('computeLogReturns', () => {
  it('returns [] for fewer than 2 prices', () => {
    expect(computeLogReturns([])).toEqual([]);
    expect(computeLogReturns([100])).toEqual([]);
  });

  it('computes ln(price[i] / price[i-1])', () => {
    const returns = computeLogReturns([100, 110]);
    expect(returns[0]).toBeCloseTo(Math.log(1.1), 8);
  });

  it('skips entries where previous price is 0 or negative', () => {
    const returns = computeLogReturns([0, 100, 110]);
    expect(returns).toHaveLength(1);
  });
});

describe('computeCumulativeReturn', () => {
  it('returns 0 for fewer than 2 prices', () => {
    expect(computeCumulativeReturn([])).toBe(0);
    expect(computeCumulativeReturn([100])).toBe(0);
  });

  it('returns 0 when starting price is 0', () => {
    expect(computeCumulativeReturn([0, 100])).toBe(0);
  });

  it('computes (last - first) / first', () => {
    expect(computeCumulativeReturn([100, 120])).toBeCloseTo(0.2, 8);
  });

  it('returns a negative value for a loss', () => {
    expect(computeCumulativeReturn([100, 80])).toBeCloseTo(-0.2, 8);
  });
});

describe('computeEquityCurve', () => {
  it('returns [initialEquity] for empty returns', () => {
    expect(computeEquityCurve([], 100)).toEqual([100]);
  });

  it('applies each return multiplicatively', () => {
    // [0.1, -0.05] starting at 100: 100 → 110 → 104.5
    const curve = computeEquityCurve([0.1, -0.05], 100);
    expect(curve[0]).toBe(100);
    expect(curve[1]).toBeCloseTo(110, 5);
    expect(curve[2]).toBeCloseTo(104.5, 5);
  });

  it('length is returns.length + 1', () => {
    expect(computeEquityCurve([0.1, 0.2, -0.05], 1_000)).toHaveLength(4);
  });

  it('defaults to initialEquity=1.0', () => {
    const curve = computeEquityCurve([0.5]);
    expect(curve[0]).toBe(1.0);
    expect(curve[1]).toBeCloseTo(1.5, 8);
  });
});
