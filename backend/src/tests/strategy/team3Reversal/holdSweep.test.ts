import { followUp, inHalf, parityOk, quantile, summarizeCell, sweepDump, toEntry, ROUND_TRIP_BPS } from '../../../runtime/team3Analysis/holdSweep';
import { simulateExit, type SessionSeries, type SimTrade } from '../../../runtime/team3Analysis/sim';
import type { DumpTrip } from '../../../runtime/team3Analysis/validate';

/** One-day hand-built series: flat price, z as given, entry window open everywhere. */
function series(z: number[], px = 100, close?: number[]): SessionSeries {
  const n = z.length;
  const ts = z.map((_, i) => 1_000_000 + i * 60_000);
  const flat = (v: number) => z.map(() => v);
  const c = close ?? flat(px);
  return {
    symbol: 'AMD', n, ts, open: c, high: c, low: c, close: c, volume: flat(1),
    vwap: flat(px), sigma: flat(1), z, crossings: flat(0), day: z.map(() => '2026-09-02'), dayStart: flat(0),
    minuteOfSession: z.map((_, i) => 30 + i), window: z.map(() => 'open'), nextOpen: c.map((_, i) => (i + 1 < n ? c[i + 1] : NaN)),
    index: new Map(ts.map((t, i) => [t, i])),
  };
}

/** Short at bar 1 (z = 2); z stays 2 until bar `revertAt`, where it crosses back to VWAP. */
function revertingAt(revertAt: number, n = 200): number[] {
  return Array.from({ length: n }, (_, i) => (i === 0 ? 0 : i >= revertAt ? -0.1 : 2));
}

function tripFromSim(s: SessionSeries, i: number, sim: SimTrade): DumpTrip {
  return {
    symbol: s.symbol, side: 'sell', entryTs: s.ts[i] + 60_000, exitTs: s.ts[sim.exitIdx] + 60_000, entryFill: sim.fill,
    entryZ: s.z[i], reason: sim.reason, barsHeld: sim.barsHeld, pnlBpsGross: (-1 * (s.close[sim.exitIdx] - sim.fill) / sim.fill) * 10_000,
  };
}

describe('holdSweep', () => {
  const s = series(revertingAt(50));
  const map = new Map([[s.symbol, s]]);
  const sim30 = simulateExit(s, 1, -1, { stopZ: 3.5, maxHoldBars: 30 })!;
  const trip = tripFromSim(s, 1, sim30);

  it('maps a dump trade to its decision bar (entryTs is the bar end)', () => {
    expect(toEntry(map, trip)).toMatchObject({ i: 1, sign: -1, day: '2026-09-02' });
  });

  it('parity at 30 passes on a matching trade and names the field that differs', () => {
    const e = toEntry(map, trip)!;
    expect(parityOk(s, e, sim30)).toBeNull();
    expect(parityOk(s, e, { ...sim30, barsHeld: 29 })).toMatch(/barsHeld/);
    expect(parityOk(s, { ...e, trip: { ...trip, reason: 'target' } }, sim30)).toMatch(/reason/);
  });

  it('a time exit at 30 becomes a target with a longer hold', () => {
    const r = sweepDump(map, [trip], [30, 60]);
    expect(r.cells.all[30].mix).toEqual({ target: 0, time: 1, stop: 0, close: 0 });
    expect(r.cells.all[60].mix).toEqual({ target: 1, time: 0, stop: 0, close: 0 });
    expect(r.follow.all).toMatchObject({ n: 1, '60': { target: 1 }, '120': { target: 1 }, close: { target: 1 } });
  });

  it('follow-up counts a stop before VWAP as a stop', () => {
    const z = Array.from({ length: 200 }, (_, i) => (i === 0 ? 0 : i >= 40 ? 3.6 : 2));
    const t = series(z);
    const e = toEntry(new Map([[t.symbol, t]]), tripFromSim(t, 1, simulateExit(t, 1, -1, { stopZ: 3.5, maxHoldBars: 30 })!))!;
    expect(followUp(new Map([[t.symbol, t]]), [e])['60']).toEqual({ target: 0, time: 0, stop: 1, close: 0 });
  });

  it('throws when the dump disagrees with the sim at 30', () => {
    expect(() => sweepDump(map, [{ ...trip, barsHeld: 12 }])).toThrow(/parity at H=30 failed/);
  });

  it('net is gross minus the round trip; p5 interpolates', () => {
    const fake = (g: number): SimTrade => ({ entryIdx: 0, exitIdx: 1, reason: 'time', barsHeld: 1, fill: 1, grossCloseBps: g, grossFillBps: g });
    const c = summarizeCell([10, 20, 30].map(fake));
    expect(c.grossBps).toBeCloseTo(20);
    expect(c.netBps).toBeCloseTo(20 - ROUND_TRIP_BPS);
    expect(c.timeGrossBps).toBeCloseTo(20);
    expect(quantile([0, 100], 0.05)).toBeCloseTo(5);
  });

  it('splits halves at 2026-09-23 inclusive', () => {
    expect(inHalf('2026-09-23', 'first')).toBe(true);
    expect(inHalf('2026-09-24', 'second')).toBe(true);
    expect(inHalf('2026-09-24', 'first')).toBe(false);
  });
});
