import { costTrade, summarize, walkSymbol, type EntryFn } from '../../../runtime/team3Analysis/evaluate';
import type { SessionSeries } from '../../../runtime/team3Analysis/sim';
import type { SessionWindow } from '../../../strategies/team3Reversal/rules';

/** A hand-built one-day series: every bar open/close = px, z as given, all in the entry window. */
function series(z: number[], px = 100, window: SessionWindow[] = z.map(() => 'open')): SessionSeries {
  const n = z.length;
  const ts = z.map((_, i) => 1_000_000 + i * 60_000);
  const flat = (v: number) => z.map(() => v);
  return {
    symbol: 'AMD', n, ts, open: flat(px), high: flat(px), low: flat(px), close: flat(px), volume: flat(1),
    vwap: flat(px), sigma: flat(1), z, crossings: flat(0), day: z.map(() => '2026-09-02'), dayStart: flat(0),
    minuteOfSession: z.map((_, i) => 30 + i), window, nextOpen: z.map((_, i) => (i + 1 < n ? px : NaN)),
    index: new Map(ts.map((t, i) => [t, i])),
  };
}

describe('walkSymbol: one position per symbol', () => {
  it('skips signals while a position is open and re-enters from the bar after the exit signal', () => {
    // z > 0 -> short; target when z <= 0. Signals wanted on 1, 2, 3, 5, 6.
    const z = [0, 2, 2, 2, -0.1, 2, 2, -0.1, 0, 0];
    const want = new Set([1, 2, 3, 5, 6]);
    const entry: EntryFn = (s, i) => (want.has(i) ? -1 : 0);
    const t = walkSymbol(series(z), entry, { stopZ: 3.5, maxHoldBars: 30 });
    // Bar 1 enters, exits on bar 4 (target). Bars 2,3 skipped. Bar 5 enters, bar 6 skipped, exit on bar 7.
    expect(t.map((x) => [x.entryTs, x.exitTs, x.reason])).toEqual([
      [1_060_000, 1_240_000, 'target'],
      [1_300_000, 1_420_000, 'target'],
    ]);
  });

  it('allows a new entry on the very bar after the exit signal bar', () => {
    const z = [0, 2, -0.1, 2, -0.1, 0];
    const entry: EntryFn = (s, i) => (i === 1 || i === 2 || i === 3 ? -1 : 0);
    const t = walkSymbol(series(z), entry);
    expect(t.map((x) => x.entryTs)).toEqual([1_060_000, 1_180_000]);
  });

  it('time-stops at maxHoldBars', () => {
    const z = [0, 2, 2, 2, 2, 2, 2];
    const t = walkSymbol(series(z), (s, i) => (i === 1 ? -1 : 0), { stopZ: 3.5, maxHoldBars: 3 });
    expect(t[0]).toMatchObject({ reason: 'time', barsHeld: 3 });
  });
});

describe('costTrade: protocol costs', () => {
  it('applies 5 bps slippage and 2 bps half spread multiplicatively per side, $0.005/share, floor(5000/close) shares', () => {
    const c = costTrade(1, 99, 100, 101);
    expect(c.qty).toBe(50); // floor(5000 / 99)
    expect(c.entryFill).toBeCloseTo(100 * 1.0005 * 1.0002, 10);
    expect(c.exitFill).toBeCloseTo(101 * 0.9995 * 0.9998, 10);
    expect(c.netUsd).toBeCloseTo(50 * (c.exitFill - c.entryFill) - 2 * 0.005 * 50, 10);
    expect(c.notional).toBeCloseTo((50 * (c.entryFill + c.exitFill)) / 2, 10);
    expect(c.grossBps).toBeCloseTo(100, 10);
  });

  it('a short earns on a fall; a flat trade loses about 14 bps plus commission', () => {
    const s = costTrade(-1, 100, 100, 99);
    expect(s.entryFill).toBeLessThan(100);
    expect(s.netUsd).toBeGreaterThan(0);
    const flat = costTrade(1, 100, 100, 100);
    const bps = (flat.netUsd / flat.notional) * 10_000;
    expect(bps).toBeCloseTo(-(14 + 1), 0); // ~14 bps fills + 1 bps commission at $100
  });

  it('summarize: bps/trade = net $ / traded notional; halves split on 2026-09-23', () => {
    const t = walkSymbol(series([0, 2, -0.1, 0]), (s, i) => (i === 1 ? -1 : 0));
    const sm = summarize(t);
    expect(sm.trades).toBe(1);
    expect(sm.netBps).toBeCloseTo((t[0].netUsd / t[0].notional) * 10_000, 10);
    expect(sm.halves[0]).toBeCloseTo(sm.netBps, 10);
    expect(Number.isNaN(sm.halves[1])).toBe(true);
  });
});
