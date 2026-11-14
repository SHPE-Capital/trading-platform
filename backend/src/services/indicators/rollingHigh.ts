/**
 * services/indicators/rollingHigh.ts
 *
 * Rolling maximum of the PRECEDING n bar highs, current bar excluded
 * (momentum breakout, research task B2). The breakout test is
 * `close > rollingHigh + b * ATR14`, so a bar must never enter its own
 * threshold.
 *
 * The window carries across sessions (recursive history is not reset at the
 * open).
 */

import { assertPositiveInteger } from './atr';

export class RollingHigh {
  private readonly buf: number[];
  private count = 0;
  private head = 0;

  /** @param n - number of preceding bars (positive integer, from config) */
  constructor(private readonly n: number) {
    assertPositiveInteger('rolling high n', n);
    this.buf = new Array<number>(n).fill(NaN);
  }

  /**
   * Returns the max high of the n bars BEFORE this one (NaN until n
   * preceding bars exist), then records this bar's high for later bars.
   */
  update(high: number): number {
    if (!Number.isFinite(high)) {
      throw new RangeError(`high must be finite, got ${high}`);
    }
    let result = NaN;
    if (this.count === this.n) {
      result = -Infinity;
      for (const h of this.buf) if (h > result) result = h;
    }
    this.buf[this.head] = high;
    this.head = (this.head + 1) % this.n;
    if (this.count < this.n) this.count += 1;
    return result;
  }
}
