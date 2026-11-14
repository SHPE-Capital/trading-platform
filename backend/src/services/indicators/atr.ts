/**
 * services/indicators/atr.ts
 *
 * Wilder ATR, incremental per-bar form (momentum strategy, research task B1).
 *
 * Initialization (documented assumption, standard Wilder / TA-Lib):
 *  - The first bar only supplies the previous close; it produces no true range.
 *  - TR = max(H-L, |H-prevClose|, |L-prevClose|) from the second bar on.
 *  - The first ATR is the plain mean of the first `period` true ranges, so it
 *    is available on bar index `period` (0-based).
 *  - After that, ATR = (prevATR * (period - 1) + TR) / period.
 * State carries across sessions; it is never reset at the open.
 *
 * Inputs:  completed regular-session bars (high, low, close).
 * Outputs: ATR, or NaN until the seed window is complete (invalid, never 0).
 */

export interface HlcBar {
  high: number;
  low: number;
  close: number;
}

/** Throws unless `value` is a positive integer. */
export function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
}

/** Throws if any bar field is not finite or the bar is internally inconsistent. */
export function assertValidHlcBar(bar: HlcBar): void {
  if (!Number.isFinite(bar.high) || !Number.isFinite(bar.low) || !Number.isFinite(bar.close)) {
    throw new RangeError(`bar has a non-finite value: ${JSON.stringify(bar)}`);
  }
  if (bar.high < bar.low) {
    throw new RangeError(`bar high ${bar.high} is below low ${bar.low}`);
  }
}

/** Wilder true range for a bar given the previous close. */
export function trueRange(bar: HlcBar, prevClose: number): number {
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - prevClose),
    Math.abs(bar.low - prevClose),
  );
}

export class WilderAtr {
  private prevClose: number | null = null;
  private trCount = 0;
  private trSum = 0;
  private atr = NaN;

  /** @param period - Wilder length (positive integer, from config) */
  constructor(private readonly period: number) {
    assertPositiveInteger('ATR period', period);
  }

  /**
   * Feeds one completed bar. Returns the ATR after this bar, or NaN while
   * warming up. Non-finite input throws: the caller owns data validity, and
   * skipping a bar would silently diverge from the batch reference.
   */
  update(bar: HlcBar): number {
    assertValidHlcBar(bar);
    const prevClose = this.prevClose;
    this.prevClose = bar.close;
    if (prevClose === null) return NaN;

    const tr = trueRange(bar, prevClose);
    if (this.trCount < this.period) {
      this.trCount += 1;
      this.trSum += tr;
      if (this.trCount === this.period) this.atr = this.trSum / this.period;
    } else {
      this.atr = (this.atr * (this.period - 1) + tr) / this.period;
    }
    return this.atr;
  }

  /** Latest ATR, NaN while warming up. */
  get value(): number {
    return this.atr;
  }
}
