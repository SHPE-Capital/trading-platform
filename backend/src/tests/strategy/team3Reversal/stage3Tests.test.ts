import { holdLabel, matchedShare, profitLabel, ratioBps, success, tradeBootstrapCI, type PricedTrade } from '../../../runtime/team3Analysis/stage3Tests';

const t = (key: string, netUsd: number, notional = 5_000): PricedTrade => ({ key, netUsd, notional });

describe('Stage 3 tests', () => {
  it('ratio bps = sum net / sum notional (engine-style dollar weighting)', () => {
    expect(ratioBps([t('a', 10, 5_000), t('b', -5, 2_500)])).toBeCloseTo((5 / 7_500) * 1e4);
  });

  it('Test 2: identical trades give a zero-width interval at the point', () => {
    const ci = tradeBootstrapCI(Array.from({ length: 12 }, (_, i) => t(`k${i}`, 5)), 0.9, 500);
    expect(ci.point).toBeCloseTo(10);
    expect(ci.lo).toBeCloseTo(10);
    expect(ci.hi).toBeCloseTo(10);
  });

  it('Test 2: a mixed sample has lo < point < hi and is deterministic', () => {
    const ts = [10, -8, 3, 25, -30, 7, 2, -1, 12, -4].map((x, i) => t(`k${i}`, x));
    const a = tradeBootstrapCI(ts, 0.9, 2_000), b = tradeBootstrapCI(ts, 0.9, 2_000);
    expect(a.lo).toBeLessThan(a.point);
    expect(a.hi).toBeGreaterThan(a.point);
    expect(a).toEqual(b);
  });

  it('Test 1: pairs by key, excludes unmatched trades, share 1 when the child is always better', () => {
    const parent = [t('a', 0), t('b', 0), t('c', 0), t('gone', 99)];
    const child = [t('a', 5), t('b', 5), t('c', 0), t('new', -99)];
    const m = matchedShare(parent, child, 500);
    expect(m).toMatchObject({ pairs: 3, changed: 2, onlyParent: 1, onlyChild: 1 });
    expect(m.meanDiff).toBeCloseTo((10 + 10 + 0) / 3);
    expect(m.share).toBeGreaterThan(0.9);
  });

  it('Test 1 labels follow the thresholds, and below the trade minimum it is inconclusive', () => {
    expect(holdLabel(0.85, 20, 'momentum')).toBe('confirmed');
    expect(holdLabel(0.75, 20, 'momentum')).toBe('suggestive');
    expect(holdLabel(0.65, 20, 'momentum')).toBe('weak');
    expect(holdLabel(0.55, 20, 'momentum')).toBe('not supported');
    expect(holdLabel(0.95, 9, 'momentum')).toBe('inconclusive');
    expect(holdLabel(0.95, 5, 'core')).toBe('confirmed');
    expect(holdLabel(0.95, 4, 'core')).toBe('inconclusive');
  });

  it('Test 2 labels: profitable only if the lower end > 0; minimums 10 Momentum / 5 Core', () => {
    expect(profitLabel({ n: 10, lo: 0.1 }, 'momentum')).toBe('profitable');
    expect(profitLabel({ n: 10, lo: -0.1 }, 'momentum')).toBe('not profitable');
    expect(profitLabel({ n: 9, lo: 50 }, 'momentum')).toBe('inconclusive');
    expect(profitLabel({ n: 5, lo: 1 }, 'core')).toBe('profitable');
    expect(profitLabel({ n: 4, lo: 1 }, 'core')).toBe('inconclusive');
  });

  it('success is decided on Momentum only, by L2 or F3', () => {
    expect(success({ L2: { label: 'profitable' }, F3: { label: 'not profitable' } })).toBe(true);
    expect(success({ L2: { label: 'inconclusive' }, F3: { label: 'profitable' } })).toBe(true);
    expect(success({ L2: { label: 'not profitable' }, F3: { label: 'inconclusive' }, F1: { label: 'profitable' } })).toBe(false);
  });
});
