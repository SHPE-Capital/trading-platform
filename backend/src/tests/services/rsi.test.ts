import { computeRSI } from '../../services/indicators/rsi';

describe('computeRSI', () => {
  it('returns null when prices array length <= period', () => {
    expect(computeRSI([1, 2, 3, 4, 5], 14)).toBeNull();
    expect(computeRSI(Array.from({ length: 14 }, (_, i) => i + 1), 14)).toBeNull();
  });

  it('returns null for an empty array', () => {
    expect(computeRSI([], 14)).toBeNull();
  });

  it('returns 100 when all price moves are gains (no losses)', () => {
    // 16 strictly increasing prices with period=14
    const prices = Array.from({ length: 16 }, (_, i) => 10 + i);
    expect(computeRSI(prices, 14)).toBe(100);
  });

  it('returns 0 when all price moves are losses (no gains)', () => {
    // 16 strictly decreasing prices with period=14 → avgGain=0 → RSI=0
    const prices = Array.from({ length: 16 }, (_, i) => 25 - i);
    expect(computeRSI(prices, 14)).toBe(0);
  });

  it('returns approximately 50 for a perfectly alternating series', () => {
    // 15 prices: alternates +1 / -1, 7 gains and 7 losses over first 14 changes
    const prices = Array.from({ length: 15 }, (_, i) => (i % 2 === 0 ? 10 : 11));
    // avgGain = 7/14 = 0.5, avgLoss = 7/14 = 0.5, rs=1 → RSI=50
    const rsi = computeRSI(prices, 14);
    expect(rsi).not.toBeNull();
    expect(rsi!).toBeCloseTo(50, 0);
  });

  it('returns a value in [0, 100]', () => {
    const prices = [100, 102, 101, 103, 102, 104, 103, 105, 104, 106, 105, 107, 106, 108, 107];
    const rsi = computeRSI(prices, 14);
    expect(rsi).not.toBeNull();
    expect(rsi!).toBeGreaterThanOrEqual(0);
    expect(rsi!).toBeLessThanOrEqual(100);
  });

  it('Wilder smoothing applies when prices extend beyond the initial period', () => {
    // Provide more than period+1 prices to exercise the Wilder smoothing loop
    const base = Array.from({ length: 16 }, (_, i) => 100 + i);
    const extended = [...base, 115, 114, 116, 113];
    const rsi = computeRSI(extended, 14);
    expect(rsi).not.toBeNull();
    expect(rsi!).toBeGreaterThanOrEqual(0);
    expect(rsi!).toBeLessThanOrEqual(100);
  });
});
