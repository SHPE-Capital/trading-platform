import { SessionVwapTracker, countCrossings } from '../../../strategies/team3Reversal/vwap';
import { OPEN_ET, fakeBar } from './helpers';

describe('SessionVwapTracker', () => {
  it('returns null before any volume has traded', () => {
    expect(new SessionVwapTracker().view(60)).toBeNull();
  });

  it('computes the volume-weighted average of typical price', () => {
    const t = new SessionVwapTracker();
    t.update(fakeBar(0, 100, 1_000, OPEN_ET));
    t.update(fakeBar(1, 110, 3_000, OPEN_ET));
    const v = t.view(60)!;
    expect(v.vwap).toBeCloseTo((100 * 1_000 + 110 * 3_000) / 4_000);
    expect(v.sessionBars).toBe(2);
    expect(v.sigma).toBeGreaterThan(0);
    expect(v.z).toBeGreaterThan(0); // last close 110 sits above VWAP 107.5
  });

  it('starts over on a new New York day', () => {
    const t = new SessionVwapTracker();
    t.update(fakeBar(0, 100, 1_000, OPEN_ET));
    t.update(fakeBar(0, 50, 1_000, OPEN_ET + 24 * 60 * 60_000));
    expect(t.view(60)!.vwap).toBeCloseTo(50);
    expect(t.view(60)!.sessionBars).toBe(1);
  });

  it('counts closes switching sides of VWAP', () => {
    const t = new SessionVwapTracker();
    [100, 102, 98, 103, 97].forEach((c, i) => t.update(fakeBar(i, c, 1_000, OPEN_ET)));
    expect(t.view(60)!.crossings).toBeGreaterThanOrEqual(3);
    expect(t.view(2)!.crossings).toBeLessThanOrEqual(1);
  });
});

describe('countCrossings', () => {
  it('skips bars exactly on VWAP', () => {
    expect(countCrossings([1, 0, -1, -1, 0, 1])).toBe(2);
    expect(countCrossings([1, 1, 1])).toBe(0);
  });
});
