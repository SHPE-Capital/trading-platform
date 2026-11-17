/**
 * strategies/team3Reversal/vwap.ts
 *
 * Session VWAP per symbol, reset each New York trading day. The strategy feeds
 * it every regular-session bar and hands filters a read-only VwapView.
 *
 * In plain words:
 *   - typical price of a bar = (high + low + close) / 3
 *   - VWAP  = sum(typical price x volume) / sum(volume), since 9:30 today
 *   - sigma = volume-weighted standard deviation of typical price around VWAP
 *   - z     = (close - VWAP) / sigma: how stretched the price is from VWAP
 *   - crossings = how many times the close switched sides of VWAP in the
 *     last `windowBars` session bars (many crossings = choppy/rotational day)
 *
 * Owner: team lead.
 */

import type { BarView, VwapView } from "./filters/types";
import { newYorkDay } from "./session";

/** Longest window we keep signs for: one full regular session of 1-minute bars. */
const MAX_SIGNS = 390;

export class SessionVwapTracker {
  private day = "";
  private sumPV = 0;
  private sumV = 0;
  private sumP2V = 0;
  private bars = 0;
  private lastClose = 0;
  /** Side of VWAP each session bar closed on: +1 above, -1 below, 0 exactly on it. */
  private signs: number[] = [];

  /** Adds one regular-session bar. A bar from a new New York day starts a fresh session. */
  update(bar: BarView): void {
    const day = newYorkDay(bar.ts);
    if (day !== this.day) this.reset(day);

    const typical = (bar.high + bar.low + bar.close) / 3;
    const volume = bar.volume > 0 ? bar.volume : 0;
    this.sumPV += typical * volume;
    this.sumV += volume;
    this.sumP2V += typical * typical * volume;
    this.bars += 1;
    this.lastClose = bar.close;

    if (this.sumV > 0) {
      const vwap = this.sumPV / this.sumV;
      this.signs.push(Math.sign(bar.close - vwap));
      if (this.signs.length > MAX_SIGNS) this.signs.shift();
    }
  }

  /** Current VWAP picture, or null before any volume has traded today. */
  view(windowBars: number): VwapView | null {
    if (this.sumV <= 0) return null;
    const vwap = this.sumPV / this.sumV;
    const variance = Math.max(0, this.sumP2V / this.sumV - vwap * vwap);
    const sigma = Math.sqrt(variance);
    return {
      vwap,
      sigma,
      z: sigma > 0 ? (this.lastClose - vwap) / sigma : null,
      sessionBars: this.bars,
      crossings: countCrossings(this.signs.slice(-windowBars)),
    };
  }

  private reset(day: string): void {
    this.day = day;
    this.sumPV = 0;
    this.sumV = 0;
    this.sumP2V = 0;
    this.bars = 0;
    this.lastClose = 0;
    this.signs = [];
  }
}

/** Counts side switches in a list of +1/-1/0 signs; bars exactly on VWAP (0) are skipped. */
export function countCrossings(signs: readonly number[]): number {
  let crossings = 0;
  let last = 0;
  for (const s of signs) {
    if (s === 0) continue;
    if (last !== 0 && s !== last) crossings += 1;
    last = s;
  }
  return crossings;
}
