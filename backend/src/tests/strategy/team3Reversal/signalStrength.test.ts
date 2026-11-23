import { computeRSI } from '../../../services/indicators/rsi';
import { rng } from '../../../runtime/team3Analysis/groups';
import {
  clusteredBootstrap, deflatedSharpe, normInv, pinnedRun, rsiDivergence, sessionRsi, stretchRsi, wilderRsiSeries,
} from '../../../runtime/team3Analysis/signalStrength';

const walk = (n: number, seed: number): number[] => {
  const r = rng(seed);
  const out = [100];
  for (let i = 1; i < n; i++) out.push(out[i - 1] + (r() - 0.5));
  return out;
};

describe('wilderRsiSeries', () => {
  it.each([2, 5, 14])('matches computeRSI on every prefix (period %i)', (p) => {
    const c = walk(80, p);
    const s = wilderRsiSeries(c, p);
    for (let i = 0; i < c.length; i++) {
      const ref = computeRSI(c.slice(0, i + 1), p);
      if (ref === null) expect(s[i]).toBeNaN();
      else expect(s[i]).toBeCloseTo(ref, 10);
    }
  });

  it('has no look-ahead: changing later closes leaves earlier values alone', () => {
    const c = walk(60, 7);
    const a = wilderRsiSeries(c, 14);
    const d = [...c];
    for (let i = 40; i < d.length; i++) d[i] += 5;
    const b = wilderRsiSeries(d, 14);
    for (let i = 0; i < 40; i++) expect(Object.is(a[i], b[i]) || a[i] === b[i]).toBe(true);
    expect(b[40]).not.toBe(a[40]);
  });

  it('sessionRsi restarts each day', () => {
    const c = [...walk(20, 1), ...walk(20, 2)];
    const dayStart = c.map((_, i) => (i < 20 ? 0 : 20));
    const s = sessionRsi({ n: c.length, close: c, dayStart }, 5);
    expect(s[20 + 4]).toBeNaN();
    expect(s[20 + 5]).toBeCloseTo(computeRSI(c.slice(20, 26), 5)!, 10);
  });
});

describe('rsiDivergence / pinnedRun', () => {
  it('flags a new price high without a new RSI high as divergence', () => {
    const close = [100, 101, 102, 101.5, 102.5];
    const rsi = [50, 70, 85, 60, 75];
    expect(rsiDivergence(close, rsi, 4, 0, 1, 30)).toBe('divergence');
  });
  it('flags a confirmed extreme and a missing new extreme', () => {
    expect(rsiDivergence([100, 101, 102], [50, 60, 80], 2, 0, 1, 30)).toBe('confirmed');
    expect(rsiDivergence([100, 103, 102], [50, 60, 80], 2, 0, 1, 30)).toBe('noNewExtreme');
  });
  it('mirrors for a down-stretch and respects the day start', () => {
    expect(rsiDivergence([100, 99, 98, 98.5, 97.5], [50, 30, 15, 40, 25], 4, 0, -1, 30)).toBe('divergence');
    // A higher close before the day start is ignored.
    expect(rsiDivergence([200, 100, 101], [90, 50, 60], 2, 1, 1, 30)).toBe('confirmed');
    expect(rsiDivergence([100], [50], 0, 0, 1, 30)).toBe('na');
  });
  it('pinnedRun counts consecutive stretch-side extremes', () => {
    expect(pinnedRun([50, 75, 80, 72], 3, 0, 1, 70)).toBe(3);
    expect(pinnedRun([50, 25, 20, 28], 3, 0, -1, 70)).toBe(3);
    expect(stretchRsi(20, -1)).toBe(80);
  });
});

describe('clusteredBootstrap', () => {
  it('resamples whole clusters', () => {
    // Two days: day A all +10 bps, day B all -10 bps. Any resample is A-only, B-only or a mix -> within [-10, 10].
    const rows = [
      ...[0, 1, 2].map(() => ({ cluster: 'A', net: 1, notional: 1000 })),
      ...[0, 1, 2].map(() => ({ cluster: 'B', net: -1, notional: 1000 })),
    ];
    const r = clusteredBootstrap(rows, 2000, rng(3));
    expect(r.point).toBeCloseTo(0, 10);
    expect(r.lo).toBeCloseTo(-10, 6);
    expect(r.hi).toBeCloseTo(10, 6);
  });
  it('is degenerate when every cluster is the same', () => {
    const rows = ['a', 'b', 'c'].map((c) => ({ cluster: c, net: 2, notional: 1000 }));
    const r = clusteredBootstrap(rows, 200, rng(1));
    expect(r.lo).toBeCloseTo(20, 10);
    expect(r.hi).toBeCloseTo(20, 10);
  });
});

describe('deflatedSharpe', () => {
  it('raises the bar with more trials', () => {
    const ret = walk(33, 9).slice(1).map((x, i, a) => x - (i ? a[i - 1] : 100) + 0.1);
    const a = deflatedSharpe(ret, 1), b = deflatedSharpe(ret, 27), c = deflatedSharpe(ret, 1309);
    expect(a.sr0).toBe(0);
    expect(b.sr0).toBeGreaterThan(0);
    expect(c.sr0).toBeGreaterThan(b.sr0);
    expect(c.dsr).toBeLessThan(b.dsr);
    expect(normInv(0.975)).toBeCloseTo(1.959964, 5);
  });
});
