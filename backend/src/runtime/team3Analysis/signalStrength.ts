/**
 * runtime/team3Analysis/signalStrength.ts
 *
 * Offline, in-sample (2026-09-01 -> 10-15) strength tests of the Team 3 candidates F1, F3, C3, L2,
 * and RSI (Wilder, session 1-minute closes) as a fresh lens. No backtests: engine dumps' trades are
 * re-costed from their bars, and variants are run with evaluate.ts walkSymbol (engine-feasible).
 *
 * Usage (from backend/): npx ts-node --transpile-only src/runtime/team3Analysis/signalStrength.ts
 * Writes tmp/team3-data/signal-strength.json (gitignored). One dump in memory at a time.
 */

import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { buildSeries, isOpportunity, simulateExit, v4Entry, V4_EXIT, type ExitCfg, type SessionSeries } from "./sim";
import { COST, HALF_SPLIT, costTrade, summarize, walkSymbol, type EntryFn, type EvalTrade } from "./evaluate";
import { circularShiftWithin, rng, shuffleWithin, type Rec } from "./groups";
import { BAR_MS, DATA_DIR } from "./validate";
import { WilderAdx } from "../../services/indicators/adx";

// ---------- pure helpers (tested) ----------

const rsiOf = (g: number, l: number): number => (l === 0 ? 100 : 100 - 100 / (1 + g / l));

/**
 * Wilder RSI after every close: out[i] uses closes[0..i] only (equals computeRSI(closes.slice(0, i + 1), period)).
 * NaN until `period` changes exist.
 */
export function wilderRsiSeries(closes: readonly number[], period: number): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) {
    const c = closes[i] - closes[i - 1];
    if (c > 0) g += c; else l += Math.abs(c);
  }
  g /= period; l /= period;
  out[period] = rsiOf(g, l);
  for (let i = period + 1; i < closes.length; i++) {
    const c = closes[i] - closes[i - 1];
    g = (g * (period - 1) + (c > 0 ? c : 0)) / period;
    l = (l * (period - 1) + (c < 0 ? Math.abs(c) : 0)) / period;
    out[i] = rsiOf(g, l);
  }
  return out;
}

/** Session RSI: restarts each day at the day's first session bar. */
export function sessionRsi(s: Pick<SessionSeries, "n" | "close" | "dayStart">, period: number): number[] {
  const out: number[] = [];
  for (let a = 0; a < s.n;) {
    let b = a;
    while (b < s.n && s.dayStart[b] === s.dayStart[a]) b++;
    out.push(...wilderRsiSeries(s.close.slice(a, b), period));
    a = b;
  }
  return out;
}

/** RSI seen from the stretch: high = extreme in the stretch's direction (overbought for z > 0, oversold for z < 0). */
export const stretchRsi = (rsi: number, zSign: number): number => (zSign > 0 ? rsi : 100 - rsi);

export type DivState = "divergence" | "confirmed" | "noNewExtreme" | "na";

/**
 * At bar i, over the prior `lookback` bars of the same day (start = day's first bar):
 * price makes a new extreme in the stretch direction (zSign) and RSI does not -> divergence (exhaustion);
 * both make a new extreme -> confirmed (trend still running); no new price extreme -> noNewExtreme.
 */
export function rsiDivergence(close: readonly number[], rsi: readonly number[], i: number, start: number, zSign: number, lookback: number): DivState {
  const a = Math.max(start, i - lookback);
  if (a >= i || !Number.isFinite(rsi[i])) return "na";
  let pMax = -Infinity, rMax = -Infinity;
  for (let k = a; k < i; k++) {
    pMax = Math.max(pMax, zSign * close[k]);
    if (Number.isFinite(rsi[k])) rMax = Math.max(rMax, zSign * (rsi[k] - 50));
  }
  if (!(zSign * close[i] > pMax)) return "noNewExtreme";
  return zSign * (rsi[i] - 50) > rMax ? "confirmed" : "divergence";
}

/** Consecutive bars up to and including i (same day) whose stretch-side RSI is >= level. */
export function pinnedRun(rsi: readonly number[], i: number, start: number, zSign: number, level: number): number {
  let n = 0;
  for (let k = i; k >= start; k--) {
    if (!(stretchRsi(rsi[k], zSign) >= level)) break;
    n++;
  }
  return n;
}

export interface ClusterRow { cluster: string; net: number; notional: number }

/** Day-clustered bootstrap of sum(net) / sum(notional) * 1e4: resamples whole clusters with replacement. */
export function clusteredBootstrap(rows: readonly ClusterRow[], B: number, rand: () => number): { point: number; lo: number; hi: number } {
  const byC = new Map<string, [number, number]>();
  for (const r of rows) {
    const c = byC.get(r.cluster) ?? [0, 0];
    c[0] += r.net; c[1] += r.notional; byC.set(r.cluster, c);
  }
  const cl = [...byC.values()];
  const tot = cl.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]);
  const point = tot[1] > 0 ? (tot[0] / tot[1]) * 1e4 : NaN;
  const stats: number[] = [];
  for (let b = 0; b < B; b++) {
    let n = 0, d = 0;
    for (let k = 0; k < cl.length; k++) {
      const c = cl[Math.floor(rand() * cl.length)];
      n += c[0]; d += c[1];
    }
    stats.push(d > 0 ? (n / d) * 1e4 : NaN);
  }
  return { point, lo: qtl(stats, 0.025), hi: qtl(stats, 0.975) };
}

export function qtl(xs: readonly number[], p: number): number {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const h = (v.length - 1) * p, lo = Math.floor(h);
  return v[lo] + (h - lo) * (v[Math.min(lo + 1, v.length - 1)] - v[lo]);
}

export function normCdf(x: number): number {
  // Abramowitz-Stegun 7.1.26 on erf.
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Acklam's inverse normal CDF. */
export function normInv(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Deflated Sharpe ratio (Bailey & Lopez de Prado 2014) on per-period returns.
 * SR0 = expected max SR of N zero-skill trials, with Var(SR_hat) ~ 1/(T-1) under the null.
 */
export function deflatedSharpe(returns: readonly number[], N: number): { sr: number; sr0: number; dsr: number; skew: number; kurt: number } {
  const T = returns.length;
  const m = returns.reduce((a, b) => a + b, 0) / T;
  const v = returns.reduce((a, b) => a + (b - m) ** 2, 0) / (T - 1);
  const sd = Math.sqrt(v);
  const sr = m / sd;
  const m2 = returns.reduce((a, b) => a + (b - m) ** 2, 0) / T;
  const skew = returns.reduce((a, b) => a + (b - m) ** 3, 0) / T / m2 ** 1.5;
  const kurt = returns.reduce((a, b) => a + (b - m) ** 4, 0) / T / m2 ** 2;
  const g = 0.5772156649;
  const sr0 = N > 1 ? Math.sqrt(1 / (T - 1)) * ((1 - g) * normInv(1 - 1 / N) + g * normInv(1 - 1 / (N * Math.E))) : 0;
  const den = Math.sqrt(Math.max(1e-12, 1 - skew * sr + ((kurt - 1) / 4) * sr * sr));
  return { sr, sr0, dsr: normCdf(((sr - sr0) * Math.sqrt(T - 1)) / den), skew, kurt };
}

export function pearson(x: readonly number[], y: readonly number[]): number {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let k = 0; k < x.length; k++) {
    const a = x[k], b = y[k];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    n++; sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b;
  }
  const cov = sxy - (sx * sy) / n, va = sxx - (sx * sx) / n, vb = syy - (sy * sy) / n;
  return cov / Math.sqrt(va * vb);
}

// ---------- data ----------

const IDS = {
  momentum: {
    V4: "bab63751-fcad-4088-ad02-6c3019d66cb2", F1: "2a628992-074b-4673-aabe-06555b13792a", F3: "f27874dd-8c1e-4898-b908-56e8c108d2d3",
    C3: "990a5e75-c896-48db-b7b4-daa97e865ce4", L2: "839972a3-6c88-44cc-bedf-cec91726456e", L5: "a17afd1b-a6a6-4232-9864-923de2b72bca",
  },
  core: {
    V4: "5a7cd486-dc60-4159-a1dd-88049fb61bb0", F1: "9756c285-ffa2-4dcf-9fb4-3c53a97ba6cd", F3: "d47f1ca0-71a9-4901-8ff3-4d36e88f31a1",
    C3: "4a40e3df-cd9d-46a5-a8ff-7df21f3b28f3", L2: "e85ff2d5-d689-42aa-8ddd-d78a2f5e9b57", L5: "06fd500d-3cd4-4556-9be4-3bc8c9d1c265",
  },
} as const;
type Uni = keyof typeof IDS;
type RunName = keyof typeof IDS.momentum;

export interface RawTrip { symbol: string; side: "buy" | "sell"; entryTs: number; exitTs: number; qty: number }
export interface Loaded { trips: RawTrip[]; row: { trades: number; netPnl: number; avgBpsPerTrade: number } }

export function loadTrips(id: string): Loaded {
  const d = JSON.parse(readFileSync(path.join(DATA_DIR, `${id}.trades.json`), "utf8"));
  return { trips: d.roundTrips, row: { trades: d.row.trades, netPnl: d.row.netPnl, avgBpsPerTrade: d.row.avgBpsPerTrade } };
}

/** Re-costs a dumped trade from the bars (entry/exit at the next raw opens, the dump's own qty). */
export function recost(all: Map<string, SessionSeries>, t: RawTrip): EvalTrade {
  const s = all.get(t.symbol)!;
  const i = s.index.get(t.entryTs - BAR_MS), k = s.index.get(t.exitTs - BAR_MS);
  if (i === undefined || k === undefined) throw new Error(`bar missing ${t.symbol}@${t.entryTs}`);
  const side: 1 | -1 = t.side === "buy" ? 1 : -1;
  const rawExit = s.nextOpen[k] > 0 ? s.nextOpen[k] : s.close[k];
  const c = costTrade(side, s.close[i], s.nextOpen[i], rawExit, { ...COST, tradeUsd: (t.qty + 0.5) * s.close[i] });
  return { symbol: t.symbol, day: s.day[i], entryTs: s.ts[i], exitTs: s.ts[k], side, reason: "", barsHeld: k - i, ...c };
}

const netBps = (t: EvalTrade): number => (t.netUsd / t.notional) * 1e4;
const agg = (ts: readonly EvalTrade[]): number => {
  const n = ts.reduce((a, t) => a + t.notional, 0);
  return n > 0 ? (ts.reduce((a, t) => a + t.netUsd, 0) / n) * 1e4 : NaN;
};
const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const r2 = (x: number): number => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);

let tested = 0;
const tally: Record<string, number> = {};
const count = (what: string, n = 1): void => { tested += n; tally[what] = (tally[what] ?? 0) + n; };

// ---------- task 1: strength ----------

function strength(ts: EvalTrade[], days: string[], seed: number) {
  const nets = ts.map(netBps), gross = ts.map((t) => t.grossBps);
  const m = mean(nets), sd = Math.sqrt(nets.reduce((a, x) => a + (x - m) ** 2, 0) / (nets.length - 1));
  const boot = clusteredBootstrap(ts.map((t) => ({ cluster: t.day, net: t.netUsd, notional: t.notional })), 5000, rng(seed));
  const byDay = new Map<string, number>(), bySym = new Map<string, number>(), grossDay = new Map<string, number>();
  for (const t of ts) {
    byDay.set(t.day, (byDay.get(t.day) ?? 0) + t.netUsd);
    bySym.set(t.symbol, (bySym.get(t.symbol) ?? 0) + t.netUsd);
    grossDay.set(t.day, (grossDay.get(t.day) ?? 0) + t.grossBps);
  }
  const tot = ts.reduce((a, t) => a + t.netUsd, 0), gTot = gross.reduce((a, b) => a + b, 0);
  const dSorted = [...byDay.values()].sort((a, b) => b - a), gSorted = [...grossDay.values()].sort((a, b) => b - a);
  const sSorted = [...bySym.entries()].sort((a, b) => b[1] - a[1]);
  const loso = [...bySym.keys()].map((sym) => ({ sym, bps: agg(ts.filter((t) => t.symbol !== sym)) })).sort((a, b) => a.bps - b.bps);
  const lodo = [...byDay.keys()].map((day) => ({ day, bps: agg(ts.filter((t) => t.day !== day)) })).sort((a, b) => a.bps - b.bps);
  const daily = days.map((d) => byDay.get(d) ?? 0);
  const sm = summarize(ts);
  return {
    trades: ts.length, days: byDay.size, netBpsAgg: r2(agg(ts)), meanNetBps: r2(m), medianNetBps: r2(qtl(nets, 0.5)),
    meanGrossBps: r2(mean(gross)), sdNetBps: r2(sd), tStat: r2(m / (sd / Math.sqrt(nets.length))),
    p10Net: r2(qtl(nets, 0.1)), p90Net: r2(qtl(nets, 0.9)), winPct: r2((100 * nets.filter((x) => x > 0).length) / nets.length),
    bootCI: [r2(boot.lo), r2(boot.hi)], halves: sm.halves.map(r2), halfN: sm.halfN, netUsd: r2(tot),
    top1DayNetShare: r2(dSorted[0] / tot), top2DayNetShare: r2((dSorted[0] + (dSorted[1] ?? 0)) / tot),
    top1DayGrossShare: r2(gSorted[0] / gTot), top2DayGrossShare: r2((gSorted[0] + (gSorted[1] ?? 0)) / gTot),
    topSymbol: sSorted[0][0], topSymbolNetShare: r2(sSorted[0][1] / tot), bySymbolUsd: Object.fromEntries(sSorted.map(([k, v]) => [k, r2(v)])),
    losoWorst: { sym: loso[0].sym, bps: r2(loso[0].bps) }, lodoWorst: { day: lodo[0].day, bps: r2(lodo[0].bps) },
    lodoDropTop2: r2(agg(ts.filter((t) => !new Set([...byDay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map((e) => e[0])).has(t.day)))),
    dailyReturns: daily,
  };
}

// ---------- entries ----------

interface CondP { minAbsZ: number | null; cross: [number, number] | null; spy: "opposite" | "neutral" | null; band: number; extra?: (s: SessionSeries, i: number, sign: number) => boolean }

/** Opportunity side (1.5 <= |z| < 3.5, entry window), never SPY, with F1/F3-style conditions. */
function condEntry(spy: SessionSeries, p: CondP): EntryFn {
  return (s, i) => {
    if (s.symbol === spy.symbol) return 0;
    const sign = isOpportunity(s, i);
    if (!sign) return 0;
    const z = s.z[i];
    if (p.minAbsZ !== null && !(Math.abs(z) > p.minAbsZ)) return 0;
    if (p.cross && (s.crossings[i] < p.cross[0] || s.crossings[i] > p.cross[1])) return 0;
    if (p.spy) {
      const j = spy.index.get(s.ts[i]);
      const zs = j === undefined ? NaN : spy.z[j];
      if (!Number.isFinite(zs)) return 0;
      if (p.spy === "neutral" && !(Math.abs(zs) < p.band)) return 0;
      if (p.spy === "opposite" && !(Math.abs(zs) >= p.band && Math.sign(zs) !== Math.sign(z))) return 0;
    }
    if (p.extra && !p.extra(s, i, sign)) return 0;
    return sign;
  };
}
const F1P: CondP = { minAbsZ: null, cross: [1, 2], spy: "opposite", band: 1 };
const F3P: CondP = { minAbsZ: 1.947, cross: [1, 2], spy: "neutral", band: 1 };
const HOLD150: ExitCfg = { stopZ: 3.5, maxHoldBars: 150 };

// ---------- RSI lens ----------

interface Lens { r2: number[]; r5: number[]; r14: number[]; adx: number[] }

function buildLens(s: SessionSeries): Lens {
  const adx: number[] = [];
  let cur = -1, a: WilderAdx | null = null;
  for (let i = 0; i < s.n; i++) {
    if (s.dayStart[i] !== cur) { cur = s.dayStart[i]; a = new WilderAdx(14); }
    adx.push(a!.update({ high: s.high[i], low: s.low[i], close: s.close[i] }).adx);
  }
  return { r2: sessionRsi(s, 2), r5: sessionRsi(s, 5), r14: sessionRsi(s, 14), adx };
}

type Family = "RSI2" | "RSI5" | "RSI14" | "DIV14" | "PIN14" | "ADX14";
const FAMILIES: Family[] = ["RSI2", "RSI5", "RSI14", "DIV14", "PIN14", "ADX14"];

function label(f: Family, s: SessionSeries, L: Lens, i: number): string {
  const zs = Math.sign(s.z[i]);
  const ext = (r: number, hi: number): string => {
    if (!Number.isFinite(r)) return "na";
    const x = stretchRsi(r, zs);
    return x >= hi ? "extreme" : x <= 100 - hi ? "counter" : "mid";
  };
  switch (f) {
    case "RSI2": return ext(L.r2[i], 90);
    case "RSI5": return ext(L.r5[i], 80);
    case "RSI14": return ext(L.r14[i], 70);
    case "DIV14": return rsiDivergence(s.close, L.r14, i, s.dayStart[i], zs, 30);
    case "PIN14": return Number.isFinite(L.r14[i]) ? (pinnedRun(L.r14, i, s.dayStart[i], zs, 70) >= 5 ? "pinned" : "notPinned") : "na";
    case "ADX14": { const v = L.adx[i]; return !Number.isFinite(v) ? "na" : v < 20 ? "<20" : v < 30 ? "20-30" : ">=30"; }
  }
}

/** Split of an engine trade set by a family; shuffle p (labels permuted within the set) on each bin's agg net bps. */
function splitTrades(ts: EvalTrade[], labels: string[], seed: number) {
  const bins = [...new Set(labels)].sort();
  const rand = rng(seed);
  const obs = new Map(bins.map((b) => [b, agg(ts.filter((_, k) => labels[k] === b))]));
  const ge = new Map(bins.map((b) => [b, 0])), le = new Map(bins.map((b) => [b, 0]));
  const P = 2000, lab = [...labels];
  for (let it = 0; it < P; it++) {
    for (let k = lab.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [lab[k], lab[j]] = [lab[j], lab[k]]; }
    for (const b of bins) {
      const v = agg(ts.filter((_, k) => lab[k] === b));
      if (v >= obs.get(b)!) ge.set(b, ge.get(b)! + 1);
      if (v <= obs.get(b)!) le.set(b, le.get(b)! + 1);
    }
  }
  return Object.fromEntries(bins.map((b) => {
    const sub = ts.filter((_, k) => labels[k] === b);
    const h1 = sub.filter((t) => t.day <= HALF_SPLIT), h2 = sub.filter((t) => t.day > HALF_SPLIT);
    return [b, { n: sub.length, grossBps: r2(mean(sub.map((t) => t.grossBps))), netBps: r2(obs.get(b)!), halves: [r2(agg(h1)), r2(agg(h2))],
      pShuffle2s: r2(Math.min(1, (2 * Math.min(ge.get(b)!, le.get(b)!)) / P)) }];
  }));
}

/** Opportunity-set split: every opportunity bar's baseline exit (overlapping, not feasible). Nulls: label permutation and circular shift. */
function splitOpp(recs: Array<{ day: string; gross: number }>, labels: string[], seed: number) {
  const bins = [...new Set(labels)].sort();
  const edges = recs.map((r) => r.gross);
  const R: Rec[] = recs.map((r, k) => ({ u: 0, h: r.day <= HALF_SPLIT ? 0 : 1, bins: Int8Array.from([bins.indexOf(labels[k])]), edge: r.gross }));
  const rand = rng(seed), P = 500, B = bins.length;
  const means = (e: ArrayLike<number>): number[] => {
    const sum = new Array<number>(B).fill(0), n = new Array<number>(B).fill(0);
    for (let k = 0; k < R.length; k++) { sum[R[k].bins[0]] += e[k]; n[R[k].bins[0]]++; }
    return sum.map((x, j) => (n[j] ? x / n[j] : NaN));
  };
  const all = mean(edges), obs = means(edges);
  const perm = new Array<number>(B).fill(0), circ = new Array<number>(B).fill(0);
  for (let it = 0; it < P; it++) {
    const mp = means(shuffleWithin(R, edges, rand)), mc = means(circularShiftWithin(R, edges, rand));
    for (let j = 0; j < B; j++) {
      if (Math.abs(mp[j] - all) >= Math.abs(obs[j] - all)) perm[j]++;
      if (Math.abs(mc[j] - all) >= Math.abs(obs[j] - all)) circ[j]++;
    }
  }
  const res: Record<string, unknown> = {};
  bins.forEach((b, j) => {
    const sub = recs.filter((_, k) => labels[k] === b);
    res[b] = { n: sub.length, grossBps: r2(obs[j]), netBps: r2(obs[j] - 14.2),
      halvesNet: [r2(mean(sub.filter((r) => r.day <= HALF_SPLIT).map((r) => r.gross)) - 14.2), r2(mean(sub.filter((r) => r.day > HALF_SPLIT).map((r) => r.gross)) - 14.2)],
      pPerm: r2(perm[j] / P), pCirc: r2(circ[j] / P) };
  });
  return res;
}

// ---------- main ----------

function main(): void {
  const out: Record<string, any> = { window: "in-sample 2026-09-01..2026-10-15", strength: {}, sensitivity: {}, decomposition: {}, overlap: {}, nulls: {}, dsr: {}, rsi: { redundancy: {}, tradeSplits: {}, oppSplits: {}, rules: {} }, parity: {} };
  const keep: Record<string, Record<string, EvalTrade[]>> = {};

  for (const uni of ["momentum", "core"] as Uni[]) {
    // Bars from the F1 dump (every dump of a universe carries the same bars); trips from each dump in turn.
    let d: any = JSON.parse(readFileSync(path.join(DATA_DIR, `${IDS[uni].F1}.trades.json`), "utf8"));
    const all = new Map<string, SessionSeries>((d.symbols as string[]).map((s) => [s, buildSeries(s, d.bars[s])]));
    d = null;
    const spy = all.get("SPY")!;
    const days = [...new Set(spy.day)].sort();
    if (days[days.length - 1] > "2026-10-15") throw new Error("out-of-sample day in dump");
    const run = (e: EntryFn, exit: ExitCfg = V4_EXIT): EvalTrade[] => [...all.values()].flatMap((s) => walkSymbol(s, e, exit));
    const trades: Record<string, EvalTrade[]> = {};
    for (const name of Object.keys(IDS[uni]) as RunName[]) {
      const L = loadTrips(IDS[uni][name]);
      trades[name] = L.trips.map((t) => recost(all, t));
      out.parity[`${name}/${uni}`] = { engineTrades: L.row.trades, engineNetUsd: L.row.netPnl, recostNetUsd: r2(trades[name].reduce((a, t) => a + t.netUsd, 0)), engineBps: L.row.avgBpsPerTrade, recostBps: r2(agg(trades[name])) };
    }
    keep[uni] = trades;
    // Walker parity for F1, F3, L2.
    const key = (t: EvalTrade) => `${t.symbol}@${t.entryTs}`;
    const par = (sim: EvalTrade[], real: EvalTrade[]) => { const k = new Set(real.map(key)); return { sim: sim.length, real: real.length, matched: sim.filter((t) => k.has(key(t))).length, simBps: r2(agg(sim)) }; };
    out.parity[`walker/${uni}`] = { F1: par(run(condEntry(spy, F1P)), trades.F1), F3: par(run(condEntry(spy, F3P)), trades.F3), L2: par(run(condEntry(spy, F1P), HOLD150), trades.L2), V4: par(run((s, i) => v4Entry(s, i)), trades.V4) };
    console.log(uni, "parity", JSON.stringify(out.parity));

    // 1a-c strength
    out.strength[uni] = {};
    (["F1", "F3", "C3", "L2", "L5", "V4"] as RunName[]).forEach((n, k) => { out.strength[uni][n] = strength(trades[n], days, 11 + k); });

    // 1d sensitivity
    const sens: Record<string, unknown> = {};
    const sm = (ts: EvalTrade[]) => { const x = summarize(ts); return { n: x.trades, netBps: r2(x.netBps), grossBps: r2(x.grossBps), halves: x.halves.map(r2), halfN: x.halfN }; };
    const crossVars: Array<[string, [number, number]]> = [["0-2", [0, 2]], ["1-2", [1, 2]], ["1-3", [1, 3]]];
    for (const cut of [1.947 * 0.9, 1.947, 1.947 * 1.1]) for (const [cl, cr] of crossVars) for (const band of [0.8, 1.0, 1.2]) {
      sens[`F3 z>${cut.toFixed(3)} x${cl} band${band}`] = sm(run(condEntry(spy, { ...F3P, minAbsZ: cut, cross: cr, band })));
      if (uni === "momentum") count("F3 sensitivity grid");
    }
    for (const [hold, exit] of [["30", V4_EXIT], ["150", HOLD150]] as Array<[string, ExitCfg]>) for (const [cl, cr] of crossVars) for (const band of [0.8, 1.0, 1.2]) {
      sens[`F1 h${hold} x${cl} spy>=${band}`] = sm(run(condEntry(spy, { ...F1P, cross: cr, band }), exit));
      if (uni === "momentum") count(`F1 sensitivity grid (hold ${hold})`);
    }
    for (const h of [90, 120, 150, 180]) {
      sens[`F1 hold${h}`] = sm(run(condEntry(spy, F1P), { stopZ: 3.5, maxHoldBars: h }));
      if (uni === "momentum") count("F1 hold neighbours");
    }
    out.sensitivity[uni] = sens;

    // 1f decomposition: crossings alone, and each signal without crossings
    out.decomposition[uni] = {
      "opp only": sm(run(condEntry(spy, { minAbsZ: null, cross: null, spy: null, band: 1 }))),
      "crossings 1-2 only": sm(run(condEntry(spy, { minAbsZ: null, cross: [1, 2], spy: null, band: 1 }))),
      "F1 w/o crossings": sm(run(condEntry(spy, { ...F1P, cross: null }))),
      "F3 w/o crossings": sm(run(condEntry(spy, { ...F3P, cross: null }))),
      "z>1.947 & x1-2 (F3 w/o SPY)": sm(run(condEntry(spy, { ...F3P, spy: null }))),
    };
    if (uni === "momentum") count("decomposition", 5);
    const k1 = new Set(trades.F1.map(key)), k3 = new Set(trades.F3.map(key));
    const shared = trades.F1.filter((t) => k3.has(key(t)));
    out.overlap[uni] = { F1: trades.F1.length, F3: trades.F3.length, shared: shared.length, sharedNetBps: r2(agg(shared)),
      F1only: r2(agg(trades.F1.filter((t) => !k3.has(key(t))))), F3only: r2(agg(trades.F3.filter((t) => !k1.has(key(t))))),
      sameDayF1F3: [...new Set(trades.F1.map((t) => t.day))].filter((dd) => trades.F3.some((t) => t.day === dd)).length };

    // 1e selection null: random subsets of the opportunity set at the same trade count, engine-feasible walk.
    const nulls: Record<string, unknown> = {};
    const targets: Array<[string, number, number]> = uni === "momentum" ? [["F1", 32, 7.14], ["F3", 31, 4.75]] : [["F1", 14, -6.57], ["F3", 29, 5.09]];
    const rand = rng(uni === "momentum" ? 101 : 202);
    for (const [name, nT, obs] of targets) {
      const randEntry = (p: number): EntryFn => (s, i) => { if (s.symbol === "SPY") return 0; const sg = isOpportunity(s, i); return sg && rand() < p ? sg : 0; };
      let lo = 1e-5, hi = 0.2;
      for (let it = 0; it < 18; it++) { const mid = Math.sqrt(lo * hi); const c = mean([0, 1, 2, 3, 4].map(() => run(randEntry(mid)).length)); if (c < nT) lo = mid; else hi = mid; }
      const p = Math.sqrt(lo * hi), draws: number[] = [], ns: number[] = [];
      for (let b = 0; b < 1000; b++) { const ts = run(randEntry(p)); draws.push(agg(ts)); ns.push(ts.length); }
      const rate = draws.filter((x) => x >= obs).length / draws.length;
      nulls[name] = { targetTrades: nT, observedBps: obs, meanTrades: r2(mean(ns)), nullMean: r2(mean(draws)), nullP95: r2(qtl(draws, 0.95)), nullP99: r2(qtl(draws, 0.99)),
        pSingle: r2(rate), pBestOf27: r2(1 - (1 - rate) ** 27), pBestOf1309: r2(1 - (1 - rate) ** 1309) };
    }
    out.nulls[uni] = nulls;

    // 1d' deflated Sharpe on daily $ (32 days), N = 27 and 1,309 (+27)
    out.dsr[uni] = Object.fromEntries((["F1", "F3", "C3", "L2"] as RunName[]).map((n) => {
      const r = out.strength[uni][n].dailyReturns as number[];
      const f = (N: number) => { const x = deflatedSharpe(r, N); return { srDaily: r2(x.sr * 100) / 100, srAnn: r2(x.sr * Math.sqrt(252)), sr0Ann: r2(x.sr0 * Math.sqrt(252)), dsr: r2(x.dsr) }; };
      return [n, { N1: f(1), N27: f(27), N1309: f(1309), N1336: f(1336) }];
    }));

    // 2. RSI lens
    const lens = new Map([...all.values()].map((s) => [s.symbol, buildLens(s)]));
    // Redundancy over the opportunity set (non-SPY) and all entry-window bars.
    const red: Record<string, unknown> = {};
    for (const scope of ["window", "opportunity"] as const) {
      const z: number[] = [], az: number[] = [], cr: number[] = [];
      const R: Record<string, { raw: number[]; st: number[] }> = { r2: { raw: [], st: [] }, r5: { raw: [], st: [] }, r14: { raw: [], st: [] } };
      let nA = 0, nB14 = 0, nAB14 = 0, nB2 = 0, nAB2 = 0;
      for (const s of all.values()) {
        if (s.symbol === "SPY") continue;
        const L = lens.get(s.symbol)!;
        for (let i = 0; i < s.n; i++) {
          if (s.window[i] !== "open" || !Number.isFinite(s.z[i]) || !Number.isFinite(L.r14[i])) continue;
          if (scope === "opportunity" && !isOpportunity(s, i)) continue;
          const zs = Math.sign(s.z[i]);
          z.push(s.z[i]); az.push(Math.abs(s.z[i])); cr.push(s.crossings[i]);
          for (const k of ["r2", "r5", "r14"] as const) { R[k].raw.push(L[k][i]); R[k].st.push(stretchRsi(L[k][i], zs)); }
          const A = Math.abs(s.z[i]) >= 2, B14 = stretchRsi(L.r14[i], zs) >= 70, B2 = stretchRsi(L.r2[i], zs) >= 90;
          if (A) nA++; if (B14) nB14++; if (A && B14) nAB14++; if (B2) nB2++; if (A && B2) nAB2++;
        }
      }
      red[scope] = {
        bars: z.length,
        corr: Object.fromEntries((["r2", "r5", "r14"] as const).map((k) => [k, {
          rsi_z: r2(pearson(R[k].raw, z)), stretchRsi_absZ: r2(pearson(R[k].st, az)), stretchRsi_crossings: r2(pearson(R[k].st, cr)),
          absRsiDev_crossings: r2(pearson(R[k].raw.map((x) => Math.abs(x - 50)), cr)),
        }])),
        overlap: { absZge2: nA, rsi14ext: nB14, both14: nAB14, pRsi14ExtGivenZ2: r2(nAB14 / nA), pZ2GivenRsi14Ext: r2(nAB14 / nB14), jaccard14: r2(nAB14 / (nA + nB14 - nAB14)),
          rsi2ext: nB2, both2: nAB2, pRsi2ExtGivenZ2: r2(nAB2 / nA), pZ2GivenRsi2Ext: r2(nAB2 / nB2), jaccard2: r2(nAB2 / (nA + nB2 - nAB2)) },
      };
    }
    out.rsi.redundancy[uni] = red;

    // Splits inside engine trade sets.
    const labOf = (f: Family, t: EvalTrade): string => { const s = all.get(t.symbol)!; return label(f, s, lens.get(t.symbol)!, s.index.get(t.entryTs)!); };
    out.rsi.tradeSplits[uni] = {};
    for (const set of ["F1", "F3", "V4"] as RunName[]) {
      out.rsi.tradeSplits[uni][set] = Object.fromEntries(FAMILIES.map((f, k) => {
        const labs = trades[set].map((t) => labOf(f, t));
        if (uni === "momentum") count(`RSI split bins in ${set}`, new Set(labs).size);
        return [f, splitTrades(trades[set], labs, 300 + k)];
      }));
    }
    // Opportunity set.
    const recs: Array<{ day: string; gross: number; s: SessionSeries; i: number }> = [];
    for (const s of all.values()) {
      if (s.symbol === "SPY") continue;
      for (let i = 0; i < s.n; i++) {
        const sg = isOpportunity(s, i);
        if (!sg) continue;
        const sim = simulateExit(s, i, sg);
        if (sim) recs.push({ day: s.day[i], gross: sim.grossFillBps, s, i });
      }
    }
    out.rsi.oppSplits[uni] = { bars: recs.length, allNetBps: r2(mean(recs.map((r) => r.gross)) - 14.2), ...Object.fromEntries(FAMILIES.map((f, k) => {
      const labs = recs.map((r) => label(f, r.s, lens.get(r.s.symbol)!, r.i));
      if (uni === "momentum") count("RSI split bins in opportunity set", new Set(labs).size);
      return [f, splitOpp(recs, labs, 500 + k)];
    })) };

    // Engine-feasible RSI rules (checked against the amendment minimums).
    const L = (s: SessionSeries) => lens.get(s.symbol)!;
    const is = (f: Family, v: string) => (s: SessionSeries, i: number) => label(f, s, L(s), i) === v;
    const not = (f: Family, v: string) => (s: SessionSeries, i: number) => { const x = label(f, s, L(s), i); return x !== v && x !== "na"; };
    const base: CondP = { minAbsZ: null, cross: null, spy: null, band: 1 };
    const rules: Record<string, CondP> = {
      "opp & DIV14=divergence": { ...base, extra: is("DIV14", "divergence") },
      "opp & DIV14=confirmed": { ...base, extra: is("DIV14", "confirmed") },
      "opp & PIN14=notPinned & x1-2": { ...base, cross: [1, 2], extra: not("PIN14", "pinned") },
      "opp & RSI2=extreme": { ...base, extra: is("RSI2", "extreme") },
      "opp & RSI14=mid": { ...base, extra: is("RSI14", "mid") },
      "opp & x1-2 & DIV14=divergence": { ...base, cross: [1, 2], extra: is("DIV14", "divergence") },
      "F3 & DIV14!=confirmed": { ...F3P, extra: not("DIV14", "confirmed") },
      "F1 & DIV14!=confirmed": { ...F1P, extra: not("DIV14", "confirmed") },
      "opp & ADX14<20 & x1-2": { ...base, cross: [1, 2], extra: is("ADX14", "<20") },
    };
    out.rsi.rules[uni] = Object.fromEntries(Object.entries(rules).map(([n, p]) => [n, sm(run(condEntry(spy, p)))]));
    if (uni === "momentum") count("RSI engine-feasible rules", Object.keys(rules).length);
    console.log(uni, "done");
  }

  // F1 dropped-crossings share etc. and rule verdicts.
  for (const n of Object.keys(out.rsi.rules.momentum)) {
    const m = out.rsi.rules.momentum[n], c = out.rsi.rules.core[n];
    const miss: string[] = [];
    if (m.n < 30) miss.push("Mom < 30 trades");
    if (Math.sign(c.netBps) !== Math.sign(m.netBps)) miss.push("Core sign differs");
    if (!(m.halves[0] >= 0 && m.halves[1] >= 0)) miss.push("a Mom half < 0");
    if (!(m.netBps > 0)) miss.push("Mom net <= 0");
    out.rsi.rules.momentum[n].miss = miss;
  }
  for (const u of ["momentum", "core"]) for (const n of Object.keys(out.strength[u])) delete out.strength[u][n].dailyReturns;
  out.groupsTested = { thisStudy: tested, byKind: tally, priorConfigs: 27, priorSurveyGroups: 1309 };
  void keep;
  writeFileSync(path.join(DATA_DIR, "signal-strength.json"), JSON.stringify(out, null, 1));
  console.log("tested", tested, JSON.stringify(tally));
}

if (require.main === module) main();
