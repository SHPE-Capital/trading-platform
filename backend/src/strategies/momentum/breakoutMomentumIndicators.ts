/**
 * strategies/momentum/breakoutMomentumIndicators.ts
 *
 * Per-symbol incremental indicator bank for one week's parameters, plus the
 * signal rules and readiness rules of research (B2 to B5). One bank is updated
 * exactly once per completed bar, in order, and holds nothing but arithmetic:
 * no clock, no I/O.
 *
 * A bar that does not follow its predecessor by exactly one minute inside a
 * session is a gap. Research resets its recursive indicators on a missing bar;
 * the bank does the same and, to stay safe, then waits for the full warm-up
 * again (a deliberate, conservative difference from research on gap days).
 *
 * Inputs:  completed 1-minute bars with their session id and minute of day.
 * Outputs: IndicatorSnapshot and per-component readiness/pass flags.
 */

import { ClockRelativeVolume, SessionVwap, WilderAdx, WilderAtr, RollingHigh } from "../../services/indicators";
import type {
  BreakoutParams,
  BreakoutSignalSettings,
  ComponentName,
  ComponentResult,
  IndicatorSnapshot,
} from "./breakoutMomentumTypes";

export interface BankBar {
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Period start, Unix ms. */
  ts: number;
  /** Unique id of the session (local date). */
  sessionId: string;
  /** Local minute of day of the bar's period start. */
  minuteOfDay: number;
}

export const BAR_MS = 60_000;

/** EMA with alpha 2/(n+1), seeded with the mean of the first n closes (research ema_trend). */
class SeededEma {
  private count = 0;
  private sum = 0;
  value = NaN;
  private readonly alpha: number;

  constructor(private readonly n: number) {
    this.alpha = 2 / (n + 1);
  }

  update(x: number): number {
    this.count += 1;
    if (this.count < this.n) this.sum += x;
    else if (this.count === this.n) {
      this.sum += x;
      this.value = this.sum / this.n;
    } else this.value = this.value + this.alpha * (x - this.value);
    return this.value;
  }
}

export interface BankStep {
  indicators: IndicatorSnapshot;
  components: Partial<Record<ComponentName, ComponentResult>>;
  /** Breakout AND every selected confirmation, every one of them ready. */
  signal: boolean;
}

export class MomentumIndicatorBank {
  private lastTs: number | null = null;
  private lastSession: string | null = null;
  /** Bars since the last reset: research's absolute bar index t is count - 1. */
  private count = 0;

  private atr!: WilderAtr;
  private high!: RollingHigh;
  private adx: WilderAdx | null = null;
  private emaFast: SeededEma | null = null;
  private emaSlow: SeededEma | null = null;
  private slowHistory: number[] = [];
  private readonly rvol: ClockRelativeVolume | null;
  private readonly vwap: SessionVwap | null;

  constructor(
    private readonly params: BreakoutParams,
    private readonly s: BreakoutSignalSettings,
  ) {
    this.rvol = params.rvol
      ? new ClockRelativeVolume({
          windowBars: params.rvol.w,
          lookbackSessions: s.rvolHistorySessions,
          minWindows: s.rvolMinObservations,
        })
      : null;
    this.vwap = params.vwap ? new SessionVwap() : null;
    this.resetRecursive();
  }

  private resetRecursive(): void {
    this.count = 0;
    this.atr = new WilderAtr(this.s.atrLength);
    this.high = new RollingHigh(this.params.breakout.n);
    this.adx = this.params.adx ? new WilderAdx(this.params.adx.period) : null;
    this.emaFast = this.params.ema ? new SeededEma(this.params.ema.fast) : null;
    this.emaSlow = this.params.ema ? new SeededEma(this.params.ema.slow) : null;
    this.slowHistory = [];
  }

  /** Feeds the next completed bar. Bars must arrive in strictly increasing `ts`. */
  update(bar: BankBar): BankStep {
    const sameSession = this.lastSession === bar.sessionId;
    if (this.lastTs !== null && sameSession && bar.ts - this.lastTs !== BAR_MS) this.resetRecursive();
    this.lastTs = bar.ts;
    this.lastSession = bar.sessionId;

    const { s, params } = this;
    const t = this.count; // absolute index of this bar since the last reset
    this.count += 1;
    const nan = NaN;

    const atr = this.atr.update(bar);
    const precedingHigh = this.high.update(bar.high);
    const adxRes = this.adx?.update(bar) ?? { adx: nan, plusDi: nan, minusDi: nan };
    const emaFast = this.emaFast?.update(bar.close) ?? nan;
    const emaSlow = this.emaSlow?.update(bar.close) ?? nan;
    let emaSlowPrev = nan;
    if (this.emaSlow) {
      this.slowHistory.push(emaSlow);
      if (this.slowHistory.length > s.emaSlowLookback + 1) this.slowHistory.shift();
      if (this.slowHistory.length === s.emaSlowLookback + 1) emaSlowPrev = this.slowHistory[0];
    }
    const rvol = this.rvol
      ? this.rvol.update({ sessionId: bar.sessionId, minuteOfDay: bar.minuteOfDay, volume: bar.volume })
      : nan;
    const vwap = this.vwap ? this.vwap.update(bar.sessionId, bar) : nan;

    const tol = s.floatTol;
    const atrOk = Number.isFinite(atr) && t >= s.warmupMultiple * s.atrLength;
    const c = bar.close;
    const thr = precedingHigh + params.breakout.b * atr;
    const components: Partial<Record<ComponentName, ComponentResult>> = {};

    // B2 breakout: C > max(H preceding n) + b*ATR, with relative tolerance.
    const boReady = Number.isFinite(precedingHigh) && atrOk;
    const boPass =
      boReady && Number.isFinite(c) && Number.isFinite(thr) && c - thr > tol * Math.max(Math.abs(c), Math.abs(thr));
    components.breakout = { ready: boReady, pass: boPass };

    if (params.adx) {
      const { period, q } = params.adx;
      const ready =
        Number.isFinite(adxRes.adx) && Number.isFinite(adxRes.plusDi) && Number.isFinite(adxRes.minusDi) &&
        t >= s.warmupMultiple * period;
      components.adx = {
        ready,
        pass: ready && adxRes.adx - q > tol * Math.max(1, Math.abs(q)) && adxRes.plusDi - adxRes.minusDi > tol,
      };
    }
    if (params.ema) {
      const { slow, d } = params.ema;
      const ready =
        Number.isFinite(emaFast) && Number.isFinite(emaSlowPrev) && atrOk && t >= s.warmupMultiple * slow;
      const norm = (emaFast - emaSlow) / atr;
      components.ema = {
        ready,
        pass:
          ready && Number.isFinite(norm) && atr > 0 &&
          norm - d > tol * Math.max(1, Math.abs(d)) &&
          emaSlow - emaSlowPrev > tol * Math.abs(emaSlow),
      };
    }
    if (params.rvol) {
      const ready = Number.isFinite(rvol);
      components.rvol = { ready, pass: ready && rvol >= params.rvol.v * (1 - tol) };
    }
    if (params.vwap) {
      const { e } = params.vwap;
      const ready = Number.isFinite(vwap) && atrOk;
      const z = (c - vwap) / atr;
      components.vwap = {
        ready,
        pass: ready && Number.isFinite(z) && atr > 0 && z >= -tol && z <= e + tol * Math.max(1, e),
      };
    }

    const results = Object.values(components);
    return {
      indicators: {
        atr, precedingHigh, breakoutThreshold: thr, adx: adxRes.adx, plusDi: adxRes.plusDi, minusDi: adxRes.minusDi,
        emaFast, emaSlow, emaSlowPrev, rvol, vwap,
      },
      components,
      signal: results.every((r) => r!.ready && r!.pass),
    };
  }
}
