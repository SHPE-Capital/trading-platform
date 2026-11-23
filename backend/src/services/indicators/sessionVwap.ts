/**
 * services/indicators/sessionVwap.ts
 *
 * Typical-price session VWAP, incremental (research task B3):
 *   VWAP = cumsum(((H + L + C) / 3) * V) / cumsum(V), reset each session.
 * This is NOT the bar `vwap` field from the data feed. The caller supplies a
 * session id (for example the exchange-local trading date); when it changes
 * the accumulators reset.
 *
 * Output is NaN while cumulative volume is zero (zero denominator: invalid).
 */

import { type HlcBar, assertValidHlcBar } from './atr';

export interface VwapBar extends HlcBar {
  volume: number;
}

export class SessionVwap {
  private sessionId: string | null = null;
  private cumPv = 0;
  private cumVol = 0;

  update(sessionId: string, bar: VwapBar): number {
    assertValidHlcBar(bar);
    if (!Number.isFinite(bar.volume) || bar.volume < 0) {
      throw new RangeError(`volume must be finite and >= 0, got ${bar.volume}`);
    }
    if (sessionId !== this.sessionId) {
      this.sessionId = sessionId;
      this.cumPv = 0;
      this.cumVol = 0;
    }
    const typical = (bar.high + bar.low + bar.close) / 3;
    this.cumPv += typical * bar.volume;
    this.cumVol += bar.volume;
    return this.cumVol > 0 ? this.cumPv / this.cumVol : NaN;
  }
}
