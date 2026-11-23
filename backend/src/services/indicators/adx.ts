/**
 * services/indicators/adx.ts
 *
 * Wilder ADX and +DI / -DI, incremental per-bar form (research task B1).
 *
 * Initialization (documented assumption, standard Wilder / TA-Lib; keep in
 * lockstep with the Python reference):
 *  - From the second bar on: upMove = H - prevH, downMove = prevL - L,
 *    +DM = upMove if upMove > downMove and upMove > 0 else 0,
 *    -DM = downMove if downMove > upMove and downMove > 0 else 0,
 *    TR as in atr.ts.
 *  - TR, +DM and -DM are Wilder-smoothed in sum form: the seed is the plain
 *    sum of the first `period` observations (bar index `period`), then
 *    S = S - S / period + x.
 *  - +DI = 100 * S(+DM) / S(TR), -DI likewise,
 *    DX = 100 * |+DI - -DI| / (+DI + -DI).
 *  - ADX seed is the mean of the first `period` DX values (bar index
 *    `2 * period - 1`), then ADX = (prevADX * (period - 1) + DX) / period.
 *  - A zero denominator (S(TR) = 0 or +DI + -DI = 0) makes DI / DX invalid for
 *    that bar: the affected outputs are NaN, that DX is not used, and the ADX
 *    state is held unchanged (assumption for a degenerate case, not expected
 *    in real data).
 * State carries across sessions.
 */

import { type HlcBar, assertPositiveInteger, assertValidHlcBar, trueRange } from './atr';

export interface AdxResult {
  adx: number;
  plusDi: number;
  minusDi: number;
}

const INVALID: Readonly<AdxResult> = { adx: NaN, plusDi: NaN, minusDi: NaN };

export class WilderAdx {
  private prev: HlcBar | null = null;
  private obsCount = 0;
  private smTr = 0;
  private smPlus = 0;
  private smMinus = 0;
  private dxCount = 0;
  private dxSum = 0;
  private adx = NaN;

  /** @param period - Wilder length (positive integer, from config) */
  constructor(private readonly period: number) {
    assertPositiveInteger('ADX period', period);
  }

  /**
   * Feeds one completed bar. Fields are NaN until each piece is ready:
   * +DI/-DI from bar index `period`, ADX from bar index `2 * period - 1`.
   * ADX is NaN on a bar whose DX is invalid even if an earlier ADX exists.
   */
  update(bar: HlcBar): AdxResult {
    assertValidHlcBar(bar);
    const prev = this.prev;
    this.prev = { high: bar.high, low: bar.low, close: bar.close };
    if (prev === null) return { ...INVALID };

    const upMove = bar.high - prev.high;
    const downMove = prev.low - bar.low;
    const plusDm = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDm = downMove > upMove && downMove > 0 ? downMove : 0;
    const tr = trueRange(bar, prev.close);

    this.obsCount += 1;
    if (this.obsCount <= this.period) {
      this.smTr += tr;
      this.smPlus += plusDm;
      this.smMinus += minusDm;
    } else {
      this.smTr += tr - this.smTr / this.period;
      this.smPlus += plusDm - this.smPlus / this.period;
      this.smMinus += minusDm - this.smMinus / this.period;
    }
    if (this.obsCount < this.period || this.smTr <= 0) return { ...INVALID };

    const plusDi = (100 * this.smPlus) / this.smTr;
    const minusDi = (100 * this.smMinus) / this.smTr;
    const diSum = plusDi + minusDi;
    if (diSum <= 0) return { adx: NaN, plusDi, minusDi };
    const dx = (100 * Math.abs(plusDi - minusDi)) / diSum;

    if (this.dxCount < this.period) {
      this.dxCount += 1;
      this.dxSum += dx;
      if (this.dxCount === this.period) this.adx = this.dxSum / this.period;
    } else {
      this.adx = (this.adx * (this.period - 1) + dx) / this.period;
    }
    return { adx: this.adx, plusDi, minusDi };
  }
}
