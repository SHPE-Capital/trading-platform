/**
 * Tests for the specced relativeToSpy rule (beta 1, own share over lookbackBars,
 * rtsMinOwnShare, rtsExcludeSymbols) and the rspy mechanism metric.
 */

import { relativeToSpyAllows } from '../../../strategies/team3Reversal/filters/relativeToSpy';
import { rspyMetrics, olsSlope } from '../../../runtime/team3Metrics/rspy';
import type { RoundTrip } from '../../../runtime/team3Metrics/trades';
import { createTeam3ReversalConfig, validateTeam3ReversalConfig } from '../../../strategies/team3Reversal/team3ReversalConfig';
import { entryInput, fakeBar, fakeHistory } from './helpers';

const spy = (startClose: number, nowClose: number) => [fakeBar(-3, startClose), fakeBar(-2, startClose), fakeBar(-1, startClose), fakeBar(0, nowClose)];

describe('relativeToSpy: own share over lookbackBars', () => {
  // stock goes 100 -> 104 over the window (total +4%)
  it.each([
    [100, 0.5, true],   // SPY flat: share 1
    [102, 0.5, true],   // SPY +2%: share 0.5 (>= cutoff)
    [102, 0.7, false],  // share 0.5 < 0.7
    [101, 0.7, true],   // SPY +1%: share 0.75
    [104, 0.5, false],  // SPY moved the same: share 0
    [96, 0.7, true],    // SPY -4%: resid 8%, share 2
  ])('SPY to %s with cutoff %s allows: %s', (spyNow, cutoff, expected) => {
    const input = entryInput({
      history: fakeHistory([100, 103, 103.5]),
      bar: fakeBar(0, 104),
      others: { SPY: spy(100, spyNow) },
      config: { rtsMinOwnShare: cutoff },
    });
    expect(relativeToSpyAllows(input)).toBe(expected);
  });

  it('measures from the oldest history bar, not the last one', () => {
    // last-bar move is all the stock's own, but over the window SPY explains it all
    const input = entryInput({
      history: fakeHistory([100, 104]),
      bar: fakeBar(0, 102),
      others: { SPY: [fakeBar(-2, 100), fakeBar(-1, 102), fakeBar(0, 102)] },
    });
    expect(relativeToSpyAllows(input)).toBe(false);
  });

  it('blocks when SPY has no bar at the window start', () => {
    const input = entryInput({ history: fakeHistory([100, 103]), bar: fakeBar(0, 104), others: { SPY: [fakeBar(-1, 100), fakeBar(0, 100)] } });
    expect(relativeToSpyAllows(input)).toBe(false);
  });

  it('never trades the excluded symbols', () => {
    const base = { history: fakeHistory([100, 103]), bar: fakeBar(0, 104), others: { SPY: spy(100, 100) } };
    expect(relativeToSpyAllows(entryInput({ ...base, symbol: 'QQQ' }))).toBe(false);
    expect(relativeToSpyAllows(entryInput({ ...base, symbol: 'SPY' }))).toBe(false);
    expect(relativeToSpyAllows(entryInput({ ...base, symbol: 'QQQ', config: { rtsExcludeSymbols: [] } }))).toBe(true);
  });

  it('validates the cutoff', () => {
    expect(() => validateTeam3ReversalConfig(createTeam3ReversalConfig({ rtsMinOwnShare: 1.5 }))).toThrow(/rtsMinOwnShare/);
  });
});

describe('rspy metric', () => {
  const trip = (side: 'buy' | 'sell', entryTs: number, exitTs: number, pnl: number, reason = 'target'): RoundTrip => ({
    symbol: 'AAPL', side, entryTs, exitTs, qty: 1, qtyWanted: 1, entryClose: 100, entryZ: null, edgeBps: null, reason, barsHeld: 1, pnlBpsGross: pnl,
  });

  it('slope is exact on a line', () => {
    expect(olsSlope([0, 1, 2], [1, 3, 5])).toBeCloseTo(2);
  });

  it('regresses trade bps on SPY bps over the holding window', () => {
    const bars = [0, 1, 2, 3].map((m) => fakeBar(m, [100, 101, 99, 100][m]));
    const out = rspyMetrics({
      signals: [], daily: [], config: { benchmarkSymbol: 'SPY' },
      barsBySymbol: new Map([['SPY', bars]]),
      roundTrips: [trip('buy', bars[0].ts, bars[1].ts, 100), trip('buy', bars[1].ts, bars[2].ts, -198, 'stop'), trip('sell', bars[2].ts, bars[3].ts, 0)],
    });
    expect(out.trades).toBe(3);
    expect(out.betaTrades).toBe(3);
    expect(out.reversionShare).toBeCloseTo(2 / 3, 3);
    expect(out.beta as number).toBeGreaterThan(0);
  });
});
