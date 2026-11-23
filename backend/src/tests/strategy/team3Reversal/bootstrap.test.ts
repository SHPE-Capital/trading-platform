import { bootstrapMean, pairDays, pairedDayBootstrap } from '../../../strategies/team3Reversal/contract/bootstrap';
import type { DailyPnl } from '../../../strategies/team3Reversal/contract/daily';

/** n weekdays-ish dates from 2026-09-01, with P&L from f(i). */
function series(n: number, f: (i: number) => number, startDay = 1): DailyPnl[] {
  return Array.from({ length: n }, (_, i) => ({ date: `2026-09-${String(startDay + i).padStart(2, '0')}`, pnl: f(i) }));
}
// Deterministic noisy baseline: alternating, uneven daily P&L.
const noisy = (i: number) => ((i * 37) % 11) * 10 - 50;

describe('pairDays: inner join by date, B minus A', () => {
  it('pairs only common dates, sorted, and reports the rest', () => {
    const a = [{ date: '2026-09-02', pnl: 5 }, { date: '2026-09-01', pnl: 1 }, { date: '2026-09-03', pnl: 0 }];
    const b = [{ date: '2026-09-01', pnl: 4 }, { date: '2026-09-02', pnl: 2 }, { date: '2026-09-04', pnl: 9 }];
    const p = pairDays(a, b);
    expect(p.dates).toEqual(['2026-09-01', '2026-09-02']);
    expect(p.diffs).toEqual([3, -3]);
    expect(p.onlyA).toEqual(['2026-09-03']);
    expect(p.onlyB).toEqual(['2026-09-04']);
  });
});

describe('pairedDayBootstrap', () => {
  it('is reproducible: same seed, same answer; another seed, a (slightly) different one', () => {
    const a = series(20, noisy);
    const b = series(20, (i) => noisy(i) + (i % 3) * 7 - 5);
    const r1 = pairedDayBootstrap(a, b, { draws: 2_000, seed: 7 });
    const r2 = pairedDayBootstrap(a, b, { draws: 2_000, seed: 7 });
    const r3 = pairedDayBootstrap(a, b, { draws: 2_000, seed: 8 });
    expect(r1).toEqual(r2);
    expect(r3.all.meanDiff).toBe(r1.all.meanDiff);   // observed mean doesn't depend on the seed
    expect(r3).not.toEqual(r1);                       // resamples (share, CI, halves) do
  });

  it('B = A + a constant gain: B wins every draw and the CI is that constant', () => {
    const a = series(20, noisy);
    const r = pairedDayBootstrap(a, series(20, (i) => noisy(i) + 25), { draws: 1_000, seed: 1 });
    expect(r.all.shareBBeatsA).toBe(1);
    expect(r.all.meanDiff).toBe(25);
    expect(r.all.ci95).toEqual([25, 25]);
    expect(r.halvesAgree).toBe(true);
  });

  it('B = A: share 0, CI [0, 0], halves do not count as agreeing', () => {
    const a = series(20, noisy);
    const r = pairedDayBootstrap(a, a, { draws: 1_000, seed: 1 });
    expect(r.all.shareBBeatsA).toBe(0);
    expect(r.all.ci95).toEqual([0, 0]);
    expect(r.halvesAgree).toBe(false);
  });

  it('the CI brackets the observed mean and share sits between 0 and 1 for a noisy difference', () => {
    const a = series(30, noisy);
    const b = series(30, (i) => noisy(i) + ((i * 13) % 7) * 4 - 10);
    const r = pairedDayBootstrap(a, b, { draws: 5_000, seed: 3 });
    expect(r.all.ci95[0]).toBeLessThanOrEqual(r.all.meanDiff);
    expect(r.all.ci95[1]).toBeGreaterThanOrEqual(r.all.meanDiff);
    expect(r.all.shareBBeatsA).toBeGreaterThan(0);
    expect(r.all.shareBBeatsA).toBeLessThan(1);
  });

  it('splits the paired days into first and second halves by date (odd extra day goes second)', () => {
    const a = series(9, () => 0);
    const b = series(9, (i) => (i < 4 ? 10 : -10));   // gains in the first 4 days, losses after
    const r = pairedDayBootstrap(a, b, { draws: 500, seed: 2 });
    expect(r.firstHalf).toMatchObject({ n: 4, from: '2026-09-01', to: '2026-09-04', meanDiff: 10, shareBBeatsA: 1 });
    expect(r.secondHalf).toMatchObject({ n: 5, from: '2026-09-05', to: '2026-09-09', meanDiff: -10, shareBBeatsA: 0 });
    expect(r.halvesAgree).toBe(false);
  });

  it('excludes unmatched dates and uses 10,000 draws by default', () => {
    const a = series(10, noisy);
    const b = series(12, (i) => noisy(i) + 5);           // two extra days only in B
    const r = pairedDayBootstrap(a, b);
    expect(r.draws).toBe(10_000);
    expect(r.all.n).toBe(10);
    expect(r.onlyB).toEqual(['2026-09-11', '2026-09-12']);
    expect(r.onlyA).toEqual([]);
  });

  it('empty input is safe', () => {
    expect(bootstrapMean([], [], { draws: 10, seed: 1 })).toEqual({ n: 0, from: null, to: null, meanDiff: 0, shareBBeatsA: 0, ci95: [0, 0] });
  });
});
