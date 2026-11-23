import { entryIdea } from '../../../strategies/team3Reversal/rules';
import { createTeam3ReversalConfig, validateTeam3ReversalConfig } from '../../../strategies/team3Reversal/team3ReversalConfig';
import { adverseBps, r1Metrics } from '../../../runtime/team3Metrics/r1';
import type { RoundTrip } from '../../../runtime/team3Metrics/trades';
import { fakeBar, fakeVwap } from './helpers';

const off = createTeam3ReversalConfig({ id: 'off' });
const on = createTeam3ReversalConfig({ id: 'on', useTurnEntry: true });
const prev = fakeBar(-1, 100);

describe('turn entry (R1, useTurnEntry)', () => {
  it('is off by default and validated as a boolean', () => {
    expect(off.useTurnEntry).toBe(false);
    expect(() => validateTeam3ReversalConfig({ ...on, useTurnEntry: 'yes' as unknown as boolean })).toThrow(/useTurnEntry/);
  });
  it('sells a down bar still >= entryZ above VWAP (the default would skip it)', () => {
    const v = fakeVwap({ vwap: 98, z: 2.5 });
    expect(entryIdea(fakeBar(0, 99.5), prev, v, on)).toMatchObject({ side: 'sell', z: 2.5 });
    expect(entryIdea(fakeBar(0, 99.5), prev, v, off)).toBeNull();
  });
  it('buys an up bar still <= -entryZ below VWAP', () => {
    expect(entryIdea(fakeBar(0, 100.5), prev, fakeVwap({ vwap: 102, z: -2.5 }), on)).toMatchObject({ side: 'buy' });
  });
  it('skips a bar still moving away from VWAP (the default entry)', () => {
    const v = fakeVwap({ vwap: 99, z: 2.5 });
    expect(entryIdea(fakeBar(0, 101), prev, v, on)).toBeNull();
    expect(entryIdea(fakeBar(0, 101), prev, v, off)).toMatchObject({ side: 'sell' });
  });
  it('keeps the stretch, stop and edge tests', () => {
    expect(entryIdea(fakeBar(0, 99.5), prev, fakeVwap({ vwap: 98, z: 1.9 }), on)).toBeNull();
    expect(entryIdea(fakeBar(0, 99.5), prev, fakeVwap({ vwap: 98, z: 3.5 }), on)).toBeNull();
    expect(entryIdea(fakeBar(0, 99.5), prev, fakeVwap({ vwap: 99.4, z: 2.5 }), on)).toBeNull();   // 10 bps
    expect(entryIdea(fakeBar(0, 100), prev, fakeVwap({ vwap: 98, z: 2.5 }), on)).toBeNull();      // flat bar
    expect(entryIdea(fakeBar(0, 99.5), prev, null, on)).toBeNull();
  });
});

describe('r1Metrics', () => {
  const rt = (side: 'buy' | 'sell', reason: string): RoundTrip => ({
    symbol: 'X', side, entryTs: 0, exitTs: 10, qty: 1, qtyWanted: 1, entryClose: 100,
    entryZ: 2, edgeBps: 20, reason, barsHeld: 3, pnlBpsGross: 0,
  });
  const bars = [0, 1, 2, 3, 4, 5, 6].map((ts) => ({ ts, open: 100, high: 100 + ts * 0.1, low: 100 - ts * 0.2, close: 100, volume: 1 }));
  it('measures adverse excursion over the 5 bars after entry', () => {
    expect(adverseBps(rt('sell', 'time'), bars)).toBeCloseTo(50);    // high 100.5
    expect(adverseBps(rt('buy', 'time'), bars)).toBeCloseTo(100);    // low 99
  });
  it('reports reversion share and mean/median adverse', () => {
    const m = r1Metrics({ signals: [], roundTrips: [rt('sell', 'target'), rt('buy', 'time')], barsBySymbol: new Map([['X', bars]]), daily: [], config: {} });
    expect(m).toMatchObject({ trades: 2, reversionShare: 0.5, adverse5MeanBps: 75, adverse5MedianBps: 75 });
  });
});
