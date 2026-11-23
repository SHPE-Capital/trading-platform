import { buildSeries, simulateExit, isOpportunity, v4Entry, type RawBar } from '../../../runtime/team3Analysis/sim';
import { binOf, ownShare, stretchRun, terciles, windowThird, crowdCount } from '../../../runtime/team3Analysis/features';
import { enumerateGroups, flagged, groupSums, membership, shuffleWithin, circularShiftWithin, rng, type Rec } from '../../../runtime/team3Analysis/groups';

// 2026-10-06, 9:30 ET = 13:30 UTC. Minute k of the session.
const T0 = Date.UTC(2026, 9, 6, 13, 30);
const at = (k: number): number => T0 + k * 60_000;
const flat = (k: number, p: number, v = 100): RawBar => [at(k), p, p, p, p, v];

/** 20 flat bars at 100 (a little noise so sigma > 0), then a path we choose; its first bar trades 400 (z about 2.2). */
function day(path: number[]): RawBar[] {
  const bars: RawBar[] = [];
  for (let k = 0; k < 20; k++) bars.push([at(k), 100, 100.05, 99.95, k % 2 ? 100.02 : 99.98, 100]);
  path.forEach((p, j) => bars.push(flat(20 + j, p, j === 0 ? 400 : 100)));
  return bars;
}

describe('team3Analysis sim', () => {
  it('skips pre-market bars and builds the engine VWAP picture', () => {
    const pre: RawBar = [T0 - 60_000, 50, 50, 50, 50, 1_000_000];
    const s = buildSeries('AAA', [pre, ...day([100])]);
    expect(s.ts[0]).toBe(T0);
    expect(s.vwap[0]).toBeCloseTo(100, 1);
  });

  it('fills at the next open and exits on target the first bar z crosses 0, scoring the exit close and the next open', () => {
    const s = buildSeries('AAA', day([101, 101.2, 100.6, 99.9, 99.8]));
    const i = 20;                              // the spike bar
    expect(isOpportunity(s, i)).toBe(-1);      // stretched up -> sell
    expect(v4Entry(s, i)).toBe(-1);            // up bar, z >= 2, edge >= 15 bps
    const t = simulateExit(s, i, -1)!;
    expect(t.fill).toBe(101.2);
    expect(t.reason).toBe('target');
    expect(s.ts[t.exitIdx]).toBe(at(23));       // 99.9 is the first close below VWAP
    expect(t.grossCloseBps).toBeCloseTo(((101.2 - 99.9) / 101.2) * 1e4, 6);
    expect(t.grossFillBps).toBeCloseTo(((101.2 - 99.8) / 101.2) * 1e4, 6);
  });

  it('times out after maxHoldBars when price never comes back', () => {
    const s = buildSeries('AAA', day(new Array(40).fill(101)));
    const t = simulateExit(s, 20, -1, { stopZ: 1e9, maxHoldBars: 30 })!;
    expect(t.reason).toBe('time');
    expect(t.barsHeld).toBe(30);
  });

  it('no entry before skipOpenMinutes', () => {
    const s = buildSeries('AAA', day([101]));
    expect(isOpportunity(s, 5)).toBe(0);
  });
});

describe('team3Analysis features', () => {
  it('ownShare is |r - r_spy| / |r| over the lookback, n/a for SPY', () => {
    const a = buildSeries('AAA', [flat(0, 100), flat(1, 101), flat(2, 102)]);
    const spy = buildSeries('SPY', [flat(0, 100), flat(1, 100.5), flat(2, 101)]);
    expect(ownShare(a, 2, spy, 30)).toBeCloseTo(Math.abs(0.02 - 0.01) / 0.02, 9);
    expect(ownShare(spy, 2, spy, 30)).toBeNaN();
  });

  it('stretchRun counts same-side stretched bars ending here; windowThird splits 15..374', () => {
    const s = buildSeries('AAA', day([101, 101.2, 100.6, 99.9]));
    expect(stretchRun(s, 21, 1.5)).toBe(stretchRun(s, 20, 1.5) + 1);
    expect(stretchRun(s, 20, 1.5)).toBeGreaterThanOrEqual(1);
    expect(stretchRun(s, 23, 1.5)).toBe(0);
    expect([windowThird(15), windowThird(134), windowThird(135), windowThird(374)]).toEqual([0, 0, 1, 2]);
  });

  it('crowdCount counts symbols stretched the same way this minute', () => {
    const up = buildSeries('A', day([101])), up2 = buildSeries('B', day([101])), down = buildSeries('C', day([99]));
    const all = new Map([['A', up], ['B', up2], ['C', down]]);
    expect(crowdCount(all, at(20), 1, 2)).toBe(2);
    expect(crowdCount(all, at(20), -1, 2)).toBe(1);
  });

  it('terciles and binOf', () => {
    const [c1, c2] = terciles([1, 2, 3, 4, 5, 6, 7]);
    expect(c1).toBeCloseTo(3); expect(c2).toBeCloseTo(5);
    const spec = { feature: 'absZ' as const, kind: 'cuts' as const, cuts: [c1, c2], labels: [] };
    expect([binOf(spec, 3), binOf(spec, 4), binOf(spec, 6), binOf(spec, NaN)]).toEqual([0, 1, 2, -1]);
  });
});

describe('team3Analysis groups', () => {
  const rec = (u: 0 | 1, h: 0 | 1, b: number[], edge: number): Rec => ({ u, h, bins: Int8Array.from(b), edge });

  it('enumerates singles, pairs and triples and sums each group per universe and half', () => {
    const groups = enumerateGroups([2, 2, 2]);
    expect(groups.length).toBe(6 + 3 * 4 + 8);
    const recs = [rec(0, 0, [0, 1, -1], 10), rec(0, 1, [0, 0, 1], 20), rec(1, 0, [0, 1, 1], 5)];
    const m = membership(recs, groups);
    const x = groupSums(recs, m, groups.length, recs.map((r) => r.edge));
    const g = groups.findIndex((gg) => gg.length === 1 && gg[0][0] === 0 && gg[0][1] === 0);
    expect([x.n[g * 2], x.s[g * 2], x.n[g * 2 + 1], x.s[g * 2 + 1]]).toEqual([2, 30, 1, 5]);
    expect([x.sh[g * 4], x.sh[g * 4 + 1]]).toEqual([10, 20]);
    // record 0 has feature 2 n/a: it is in no group that uses feature 2
    const triple = groups.findIndex((gg) => gg.length === 3 && gg[0][1] === 0 && gg[1][1] === 1 && gg[2][1] === 1);
    expect(x.n[triple * 2]).toBe(0);
    expect(x.n[triple * 2 + 1]).toBe(1);
  });

  it('flag rule: Mom n >= 50, edge >= 14, Core > 0, both Mom halves >= 0', () => {
    const ok = { n: [60, 10] as [number, number], mean: [15, 1] as [number, number], halfN: [30, 30] as [number, number], halfMean: [10, 20] as [number, number], coreHalfMean: [1, 1] as [number, number] };
    expect(flagged(ok)).toBe(true);
    expect(flagged({ ...ok, mean: [15, -1] })).toBe(false);
    expect(flagged({ ...ok, halfMean: [-1, 31] })).toBe(false);
    expect(flagged({ ...ok, n: [49, 10] })).toBe(false);
    expect(flagged(ok, { minMomN: 50, minMomEdge: 14, minCoreN: 50 })).toBe(false);
  });

  it('shuffles keep each universe\'s edges in that universe', () => {
    const recs = [rec(0, 0, [0], 1), rec(0, 0, [0], 2), rec(0, 0, [0], 3), rec(1, 0, [0], 100), rec(1, 0, [0], 200)];
    const edges = recs.map((r) => r.edge);
    for (const f of [shuffleWithin, circularShiftWithin]) {
      const e = Array.from(f(recs, edges, rng(1)));
      expect(e.slice(0, 3).sort()).toEqual([1, 2, 3]);
      expect(e.slice(3).sort()).toEqual([100, 200]);
    }
  });
});
