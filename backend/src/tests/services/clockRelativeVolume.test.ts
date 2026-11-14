import { ClockRelativeVolume } from '../../services/indicators/clockRelativeVolume';

type Session = Record<number, number>;

/** Feeds a session's minutes in order, returning RVOL per minute. */
function feed(rv: ClockRelativeVolume, sessionId: string, vols: Session): Record<number, number> {
  const out: Record<number, number> = {};
  for (const m of Object.keys(vols).map(Number).sort((a, b) => a - b)) {
    out[m] = rv.update({ sessionId, minuteOfDay: m, volume: vols[m] });
  }
  return out;
}

// w = 2, lookback = 3 sessions, minWindows = 2 (test-sized; protocol uses 20 / 15).
// Minutes 570, 571, 572.
const D1: Session = { 570: 10, 571: 20, 572: 30 };
const D2: Session = { 570: 5, 571: 15, 572: 25 };
const D3: Session = { 570: 20, 571: 40, 572: 60 };
const opts = { windowBars: 2, lookbackSessions: 3, minWindows: 2 };

function primed(): ClockRelativeVolume {
  const rv = new ClockRelativeVolume(opts);
  feed(rv, 'd1', D1);
  feed(rv, 'd2', D2);
  feed(rv, 'd3', D3);
  return rv;
}

describe('ClockRelativeVolume', () => {
  it('is invalid during the opening window (nothing carries over from the prior session)', () => {
    const rv = primed();
    // 570 is the first bar of d4: only 1 of w=2 current bars exists
    expect(rv.update({ sessionId: 'd4', minuteOfDay: 570, volume: 30 })).toBeNaN();
  });

  it('divides the current window sum by the median of the same clock window', () => {
    const rv = primed();
    rv.update({ sessionId: 'd4', minuteOfDay: 570, volume: 30 });
    // current 30+50 = 80; history 570-571: d1 30, d2 20, d3 60 -> median 30
    expect(rv.update({ sessionId: 'd4', minuteOfDay: 571, volume: 50 })).toBeCloseTo(80 / 30, 10);
    // current 50+100 = 150; history 571-572: 50, 40, 100 -> median 50
    expect(rv.update({ sessionId: 'd4', minuteOfDay: 572, volume: 100 })).toBeCloseTo(3, 10);
  });

  it('uses the median, not the mean (even count averages the middle two)', () => {
    const rv = new ClockRelativeVolume({ windowBars: 1, lookbackSessions: 4, minWindows: 4 });
    feed(rv, 'a', { 570: 10 });
    feed(rv, 'b', { 570: 20 });
    feed(rv, 'c', { 570: 30 });
    feed(rv, 'd', { 570: 1000 });
    // median(10,20,30,1000) = 25 (mean would be 265)
    expect(rv.update({ sessionId: 'e', minuteOfDay: 570, volume: 50 })).toBeCloseTo(2, 10);
  });

  it('is invalid with fewer than minWindows usable historical windows', () => {
    const rv = new ClockRelativeVolume({ ...opts, minWindows: 3, lookbackSessions: 3 });
    feed(rv, 'd1', D1);
    feed(rv, 'd2', { 570: 5, 572: 25 }); // 571 missing: windows ending 571 and 572 unusable
    feed(rv, 'd3', D3);
    rv.update({ sessionId: 'd4', minuteOfDay: 570, volume: 30 });
    expect(rv.update({ sessionId: 'd4', minuteOfDay: 571, volume: 50 })).toBeNaN();
  });

  it('skips a history window with a missing minute but still counts the others', () => {
    const rv = new ClockRelativeVolume(opts);
    feed(rv, 'd1', D1);
    feed(rv, 'd2', { 570: 5, 572: 25 });
    feed(rv, 'd3', D3);
    rv.update({ sessionId: 'd4', minuteOfDay: 570, volume: 30 });
    // usable: d1 30, d3 60 (d2 unusable) -> median 45; current 80
    expect(rv.update({ sessionId: 'd4', minuteOfDay: 571, volume: 50 })).toBeCloseTo(80 / 45, 10);
  });

  it('treats an early-close session as unusable for late clock windows', () => {
    const rv = new ClockRelativeVolume(opts);
    feed(rv, 'd1', D1);
    feed(rv, 'd2', { 570: 5, 571: 15 }); // early close: no 572
    feed(rv, 'd3', D3);
    rv.update({ sessionId: 'd4', minuteOfDay: 570, volume: 30 });
    rv.update({ sessionId: 'd4', minuteOfDay: 571, volume: 50 });
    // window 571-572: d2 unusable; d1 50, d3 100 -> median 75; current 50+100=150
    expect(rv.update({ sessionId: 'd4', minuteOfDay: 572, volume: 100 })).toBeCloseTo(2, 10);
  });

  it('evicts sessions older than lookbackSessions', () => {
    const rv = primed();
    feed(rv, 'd4', { 570: 100, 571: 100, 572: 100 });
    // lookback 3: d1 is gone, history = d2, d3, d4. window 570-571: 20, 60, 200 -> median 60
    rv.update({ sessionId: 'd5', minuteOfDay: 570, volume: 60 });
    expect(rv.update({ sessionId: 'd5', minuteOfDay: 571, volume: 60 })).toBeCloseTo(2, 10);
  });

  it('is invalid when the historical median is zero', () => {
    const rv = new ClockRelativeVolume({ windowBars: 1, lookbackSessions: 2, minWindows: 2 });
    feed(rv, 'a', { 570: 0 });
    feed(rv, 'b', { 570: 0 });
    expect(rv.update({ sessionId: 'c', minuteOfDay: 570, volume: 10 })).toBeNaN();
  });

  it('validates options and input ordering', () => {
    expect(() => new ClockRelativeVolume({ ...opts, windowBars: 0 })).toThrow(RangeError);
    expect(() => new ClockRelativeVolume({ ...opts, minWindows: 4 })).toThrow(RangeError);
    const rv = new ClockRelativeVolume(opts);
    rv.update({ sessionId: 's', minuteOfDay: 570, volume: 1 });
    expect(() => rv.update({ sessionId: 's', minuteOfDay: 570, volume: 1 })).toThrow(RangeError);
    expect(() => rv.update({ sessionId: 's', minuteOfDay: 571, volume: -1 })).toThrow(RangeError);
  });
});
