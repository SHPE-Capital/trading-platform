import { exitReason } from '../../../strategies/team3Reversal/rules';
import { createTeam3ReversalConfig, validateTeam3ReversalConfig } from '../../../strategies/team3Reversal/team3ReversalConfig';
import { r4Metrics } from '../../../runtime/team3Metrics/r4';
import type { StrategySignal } from '../../../types/strategy';

const on = createTeam3ReversalConfig({ id: 'so-on', useScaleOut: true, tpFraction: 0.5 });
const short = { qty: -10, barsHeld: 3, fromEarlierDay: false, entryZ: 2.4 };

describe('R4 scale-out', () => {
  it('is off by default', () => {
    expect(createTeam3ReversalConfig().useScaleOut).toBe(false);
  });
  it('fires partway once, then the rest rides to VWAP, stop or time', () => {
    expect(exitReason(short, 'open', 1.2, on)).toBe('partway');
    expect(exitReason({ ...short, scaledOut: true }, 'open', 1.0, on)).toBeNull();
    expect(exitReason({ ...short, scaledOut: true }, 'open', -0.1, on)).toBe('target');
    expect(exitReason({ ...short, scaledOut: true }, 'open', 3.6, on)).toBe('stop');
    expect(exitReason({ ...short, scaledOut: true, barsHeld: 30 }, 'open', 1.0, on)).toBe('time');
  });
  it('cannot be combined with the full partway target', () => {
    expect(() => validateTeam3ReversalConfig({ ...on, usePartwayTarget: true })).toThrow(/alternatives/);
  });
  it('the R4 metric pairs both legs into one trip, share-weighted', () => {
    const sig = (ts: number, meta: Record<string, unknown>, qty: number, direction = 'close_short') =>
      ({ symbol: 'X', ts, qty, direction, meta } as unknown as StrategySignal);
    const signals = [
      sig(1, { kind: 'enter', vwapZ: 2.4, close: 100 }, 10, 'short'),
      sig(2, { kind: 'exit', reason: 'partway', partial: true, pnlBpsGross: 20, barsHeld: 2 }, 5),
      sig(3, { kind: 'exit', reason: 'time', pnlBpsGross: -10, barsHeld: 30 }, 5),
    ];
    const m = r4Metrics({ signals, roundTrips: [], barsBySymbol: new Map(), daily: [], config: {} });
    expect(m).toMatchObject({ roundTrips: 1, avgGrossBps: 5, exitMix: { 'partway+time': 1 }, reversionSharePct: 100 });
  });
});
