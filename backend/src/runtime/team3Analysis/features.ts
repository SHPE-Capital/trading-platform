/**
 * runtime/team3Analysis/features.ts
 *
 * The 12 S4 entry-time features, each read from bars at or before the signal bar
 * (no lookahead), and the binning (at most 3 bins, edges fixed before outcomes).
 * Owner: team lead. Pure: no I/O.
 */

import type { SessionSeries } from "./sim";

export const FEATURES = [
  "ownShare", "absZ", "turnBar", "crowded", "edgeBps", "crossings60",
  "timeOfDay", "volRatio", "rangeSigma", "spySameSide", "trendBps", "stretchRun",
] as const;
export type FeatureName = (typeof FEATURES)[number];
/** NaN = not available (e.g. SPY's own share). */
export type FeatureRow = Record<FeatureName, number>;

export interface Ctx {
  /** Every symbol of the universe. */
  all: ReadonlyMap<string, SessionSeries>;
  spy: SessionSeries;
  lookbackBars: number;   // 30
  crowdZ: number;         // 2
  crowdMin: number;       // 3
  stretchZ: number;       // 1.5
}

/** Stock-specific share, beta 1 (relativeToSpy's formula): |r_stock - r_spy| / |r_stock| from bar start..i, exact SPY ts. */
export function ownShare(s: SessionSeries, i: number, spy: SessionSeries, lookback: number): number {
  if (s.symbol === spy.symbol) return NaN;
  const start = Math.max(s.dayStart[i], i - lookback);
  if (start >= i) return NaN;
  const a = spy.index.get(s.ts[start]), b = spy.index.get(s.ts[i]);
  if (a === undefined || b === undefined) return NaN;
  const total = s.close[i] / s.close[start] - 1;
  if (total === 0) return NaN;
  return Math.abs(total - (spy.close[b] / spy.close[a] - 1)) / Math.abs(total);
}

/** 1 if bar i's close moved toward VWAP vs the previous close for a trade of side `sign` (+1 long, -1 short). */
export const turnBar = (s: SessionSeries, i: number, sign: number): number =>
  (sign > 0 ? s.close[i] > s.close[i - 1] : s.close[i] < s.close[i - 1]) ? 1 : 0;

/** How many universe symbols (this one included) have z >= crowdZ on the same side at this exact minute. */
export function crowdCount(all: ReadonlyMap<string, SessionSeries>, ts: number, zSign: number, crowdZ: number): number {
  let n = 0;
  for (const s of all.values()) {
    const j = s.index.get(ts);
    if (j === undefined) continue;
    const z = s.z[j];
    if (!Number.isNaN(z) && z * zSign >= crowdZ) n++;
  }
  return n;
}

/** Mean volume of up to `n` earlier session bars today; NaN if none. */
export function priorMeanVolume(s: SessionSeries, i: number, n: number): number {
  const start = Math.max(s.dayStart[i], i - n);
  if (start >= i) return NaN;
  let sum = 0;
  for (let k = start; k < i; k++) sum += s.volume[k];
  return sum / (i - start);
}

/** Consecutive session bars up to and including i with |z| >= stretchZ on the same side as z[i]. */
export function stretchRun(s: SessionSeries, i: number, stretchZ: number): number {
  const sgn = Math.sign(s.z[i]);
  let n = 0;
  for (let k = i; k >= s.dayStart[i]; k--) {
    const z = s.z[k];
    if (Number.isNaN(z) || Math.sign(z) !== sgn || Math.abs(z) < stretchZ) break;
    n++;
  }
  return n;
}

/** Third of the entry window (minutes 15..374 since 9:30): 0 open, 1 mid, 2 late. */
export const windowThird = (minuteOfSession: number, first = 15, last = 374): number =>
  Math.min(2, Math.floor(((minuteOfSession - first) * 3) / (last - first + 1)));

/** SPY's z vs the trade's stretch: 1 same side (|zSpy| >= 1, same sign as the stock's z), 0 opposite, 0.5 neutral (|zSpy| < 1). NaN for SPY itself. */
export function spySide(s: SessionSeries, i: number, spy: SessionSeries): number {
  if (s.symbol === spy.symbol) return NaN;
  const j = spy.index.get(s.ts[i]);
  if (j === undefined || Number.isNaN(spy.z[j])) return NaN;
  const zs = spy.z[j];
  if (Math.abs(zs) < 1) return 0.5;
  return Math.sign(zs) === Math.sign(s.z[i]) ? 1 : 0;
}

/** All 12 features for a trade signalled on session bar i of s, side `sign` (+1 long / -1 short). */
export function featuresAt(s: SessionSeries, i: number, sign: number, c: Ctx): FeatureRow {
  const firstOpen = s.open[s.dayStart[i]];
  const vMean = priorMeanVolume(s, i, c.lookbackBars);
  return {
    ownShare: ownShare(s, i, c.spy, c.lookbackBars),
    absZ: Math.abs(s.z[i]),
    turnBar: turnBar(s, i, sign),
    crowded: crowdCount(c.all, s.ts[i], Math.sign(s.z[i]), c.crowdZ) >= c.crowdMin ? 1 : 0,
    edgeBps: (Math.abs(s.close[i] - s.vwap[i]) / s.close[i]) * 10_000,
    crossings60: s.crossings[i],          // the engine's own count (vwapWindowBars 60)
    timeOfDay: windowThird(s.minuteOfSession[i]),
    volRatio: vMean > 0 ? s.volume[i] / vMean : NaN,
    rangeSigma: s.sigma[i] > 0 ? (s.high[i] - s.low[i]) / s.sigma[i] : NaN,
    spySameSide: spySide(s, i, c.spy),
    trendBps: (Math.abs(s.close[i] - firstOpen) / firstOpen) * 10_000,
    stretchRun: stretchRun(s, i, c.stretchZ),
  };
}

/** A feature's bins: `cuts` [c1, c2] means bin 0: x <= c1, bin 1: c1 < x <= c2, bin 2: x > c2. Categorical features list their values. */
export interface BinSpec { feature: FeatureName; kind: "cuts" | "values"; cuts?: number[]; values?: number[]; labels: string[] }

/** Tercile cut points (type-7 quantiles at 1/3, 2/3) of the finite values. */
export function terciles(xs: readonly number[]): [number, number] {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const q = (p: number): number => {
    const h = (v.length - 1) * p, lo = Math.floor(h);
    return v[lo] + (h - lo) * ((v[Math.min(lo + 1, v.length - 1)]) - v[lo]);
  };
  return [q(1 / 3), q(2 / 3)];
}

/** Bin index of x under spec, or -1 if x is NaN / not a listed value. */
export function binOf(spec: BinSpec, x: number): number {
  if (!Number.isFinite(x)) return -1;
  if (spec.kind === "values") return spec.values!.indexOf(x);
  const [c1, c2] = spec.cuts!;
  if (x <= c1) return 0;
  return c2 === undefined || x <= c2 ? 1 : 2;
}
