/**
 * services/indicators/clockRelativeVolume.ts
 *
 * Clock-window relative volume (research task B3):
 *   RVOL = sum of volume over the latest w CURRENT-session bars
 *          / median of the same clock-time window over the preceding
 *            `lookbackSessions` sessions.
 * Consumers test `RVOL >= v`. Rules:
 *  - The window is the w consecutive clock minutes ending at the current bar.
 *    All w bars must exist, so the opening window never carries over from the
 *    previous session (NaN until w bars of the current session exist).
 *  - A historical window is usable only if all w of its minutes exist in that
 *    session (early closes and missing minutes make it unusable).
 *  - Fewer than `minWindows` usable historical windows, or a zero median, is
 *    invalid (NaN).
 *  - The lookback is the preceding `lookbackSessions` sessions seen by this
 *    instance (any session with at least one bar), most recent first.
 *
 * The caller supplies the session id and the minute-of-day (exchange-local
 * clock minute of the bar) so this module stays timezone-free.
 */

import { assertPositiveInteger } from './atr';

export interface ClockRvolOptions {
  /** w: bars in the window. */
  windowBars: number;
  /** Preceding sessions to look back over (20 in the protocol). */
  lookbackSessions: number;
  /** Minimum usable historical windows (15 in the protocol). */
  minWindows: number;
}

export interface ClockRvolBar {
  sessionId: string;
  /** Exchange-local minute of the day, e.g. 570 for 09:30. */
  minuteOfDay: number;
  volume: number;
}

type SessionVolumes = Map<number, number>;

export class ClockRelativeVolume {
  private current: SessionVolumes = new Map();
  private currentId: string | null = null;
  private lastMinute = -Infinity;
  /** Completed sessions, oldest first. */
  private history: SessionVolumes[] = [];

  constructor(private readonly opts: ClockRvolOptions) {
    assertPositiveInteger('windowBars', opts.windowBars);
    assertPositiveInteger('lookbackSessions', opts.lookbackSessions);
    assertPositiveInteger('minWindows', opts.minWindows);
    if (opts.minWindows > opts.lookbackSessions) {
      throw new RangeError('minWindows cannot exceed lookbackSessions');
    }
  }

  /** Feeds one completed bar; returns RVOL after this bar, or NaN if invalid. */
  update(bar: ClockRvolBar): number {
    if (!Number.isInteger(bar.minuteOfDay)) {
      throw new RangeError(`minuteOfDay must be an integer, got ${bar.minuteOfDay}`);
    }
    if (!Number.isFinite(bar.volume) || bar.volume < 0) {
      throw new RangeError(`volume must be finite and >= 0, got ${bar.volume}`);
    }
    if (bar.sessionId !== this.currentId) {
      if (this.currentId !== null) {
        this.history.push(this.current);
        if (this.history.length > this.opts.lookbackSessions) this.history.shift();
      }
      this.currentId = bar.sessionId;
      this.current = new Map();
      this.lastMinute = -Infinity;
    }
    if (bar.minuteOfDay <= this.lastMinute) {
      throw new RangeError(
        `bars must be strictly increasing in minuteOfDay within a session (${bar.minuteOfDay} after ${this.lastMinute})`,
      );
    }
    this.lastMinute = bar.minuteOfDay;
    this.current.set(bar.minuteOfDay, bar.volume);

    const currentSum = this.windowSum(this.current, bar.minuteOfDay);
    if (Number.isNaN(currentSum)) return NaN;

    const sums: number[] = [];
    for (const session of this.history) {
      const s = this.windowSum(session, bar.minuteOfDay);
      if (!Number.isNaN(s)) sums.push(s);
    }
    if (sums.length < this.opts.minWindows) return NaN;
    const med = median(sums);
    return med > 0 ? currentSum / med : NaN;
  }

  /** Sum of the w clock minutes ending at `endMinute`, NaN if any is missing. */
  private windowSum(session: SessionVolumes, endMinute: number): number {
    let sum = 0;
    for (let m = endMinute - this.opts.windowBars + 1; m <= endMinute; m++) {
      const v = session.get(m);
      if (v === undefined) return NaN;
      sum += v;
    }
    return sum;
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
