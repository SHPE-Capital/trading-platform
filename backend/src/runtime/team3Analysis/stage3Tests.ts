/**
 * runtime/team3Analysis/stage3Tests.ts
 *
 * Stage 3 (out-of-sample) tests, pre-registered in docs/team3/ablation.md "Stage 3 pre-registration"
 * before any OOS run. Pure functions plus a main that reads the OOS dumps.
 *
 *   Test 1  matchedShare: pair child vs parent trades by symbol + entryTs, per-pair net bps difference,
 *           bootstrap the pairs; share of draws with mean diff > 0.
 *   Test 2  tradeBootstrapCI: resample a config's trades; statistic = sum net $ / sum notional (bps),
 *           the engine's dollar-weighted bps/trade; 90% percentile interval.
 *   Test 3  day bootstrap C3 vs V4: runtime/team3Bootstrap.ts <V4> <C3> --stage3 (no code here).
 *
 * Trades are re-costed from the dump's bars with signalStrength.ts recost() (reproduces the engine to the cent).
 *
 * Usage (from backend/): npx ts-node --transpile-only src/runtime/team3Analysis/stage3Tests.ts <ids.json>
 *   ids.json = {"momentum": {"V4": "<id>", "C3": "<id>", ...}, "core": {...}}
 * Writes tmp/team3-data/stage3-results.json (gitignored).
 */

import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { buildSeries, type SessionSeries } from "./sim";
import { DATA_DIR, loadDump } from "./validate";
import { rng } from "./groups";
import { recost, type RawTrip } from "./signalStrength";
import type { EvalTrade } from "./evaluate";

export const SEED = 20261124;
export const DRAWS = 10_000;
export const MIN_TRADES = { momentum: 10, core: 5 } as const;
export type Universe = keyof typeof MIN_TRADES;

export interface PricedTrade { key: string; netUsd: number; notional: number }

export const tradeBps = (t: PricedTrade): number => (t.netUsd / t.notional) * 1e4;
export const ratioBps = (ts: readonly PricedTrade[]): number => {
  const n = ts.reduce((a, t) => a + t.notional, 0);
  return n > 0 ? (ts.reduce((a, t) => a + t.netUsd, 0) / n) * 1e4 : NaN;
};

export function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Test 2: trade bootstrap of dollar-weighted net bps/trade. level 0.90 -> 5th / 95th percentiles. */
export function tradeBootstrapCI(trades: readonly PricedTrade[], level = 0.9, draws = DRAWS, seed = SEED): { n: number; point: number; lo: number; hi: number } {
  const n = trades.length;
  if (!n) return { n, point: NaN, lo: NaN, hi: NaN };
  const rand = rng(seed), stats: number[] = [];
  for (let b = 0; b < draws; b++) {
    let net = 0, notional = 0;
    for (let j = 0; j < n; j++) { const t = trades[Math.floor(rand() * n)]; net += t.netUsd; notional += t.notional; }
    stats.push((net / notional) * 1e4);
  }
  stats.sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  return { n, point: ratioBps(trades), lo: percentile(stats, tail), hi: percentile(stats, 1 - tail) };
}

/** Test 1: matched-trade bootstrap of child minus parent net bps per pair. */
export function matchedShare(parent: readonly PricedTrade[], child: readonly PricedTrade[], draws = DRAWS, seed = SEED) {
  const pm = new Map(parent.map((t) => [t.key, t]));
  const diffs: number[] = [];
  let changed = 0;
  for (const c of child) {
    const p = pm.get(c.key);
    if (!p) continue;
    const d = tradeBps(c) - tradeBps(p);
    diffs.push(d);
    if (Math.abs(d) > 1e-9) changed++;
  }
  const ck = new Set(child.map((t) => t.key));
  const onlyParent = parent.filter((t) => !ck.has(t.key)).length;
  const onlyChild = child.length - diffs.length;
  const n = diffs.length;
  if (!n) return { pairs: 0, changed, meanDiff: NaN, share: NaN, onlyParent, onlyChild };
  const rand = rng(seed);
  let wins = 0;
  for (let b = 0; b < draws; b++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += diffs[Math.floor(rand() * n)];
    if (s > 0) wins++;
  }
  return { pairs: n, changed, meanDiff: diffs.reduce((a, x) => a + x, 0) / n, share: wins / draws, onlyParent, onlyChild };
}

export type HoldLabel = "confirmed" | "suggestive" | "weak" | "not supported" | "inconclusive";
/** Test 1 labels: >= 0.8 confirmed, >= 0.7 suggestive, >= 0.6 weak, else not supported. */
export function holdLabel(share: number, pairs: number, uni: Universe): HoldLabel {
  if (!(pairs >= MIN_TRADES[uni])) return "inconclusive";
  return share >= 0.8 ? "confirmed" : share >= 0.7 ? "suggestive" : share >= 0.6 ? "weak" : "not supported";
}

export type ProfitLabel = "profitable" | "not profitable" | "inconclusive";
/** Test 2 label: profitable only if the 90% lower end > 0, with the universe's minimum trades. */
export function profitLabel(ci: { n: number; lo: number }, uni: Universe): ProfitLabel {
  if (ci.n < MIN_TRADES[uni]) return "inconclusive";
  return ci.lo > 0 ? "profitable" : "not profitable";
}

/** Success rule: L2 or F3 profitable on Momentum. Core is supportive only and never enters this. */
export function success(momentum: Record<string, { label: ProfitLabel }>): boolean {
  return ["L2", "F3"].some((k) => momentum[k]?.label === "profitable");
}

function priced(id: string): PricedTrade[] {
  const d = loadDump(id);
  const all = new Map<string, SessionSeries>(d.symbols.map((s) => [s, buildSeries(s, d.bars[s])]));
  return (d.roundTrips as unknown as RawTrip[]).map((t) => {
    const e: EvalTrade = recost(all, t);
    return { key: `${t.symbol}@${t.entryTs}`, netUsd: e.netUsd, notional: e.notional };
  });
}

function main(): void {
  const file = process.argv[2];
  if (!file) throw new Error("usage: stage3Tests.ts <ids.json>");
  const ids = JSON.parse(readFileSync(file, "utf8")) as Record<Universe, Record<string, string>>;
  const out: Record<string, unknown> = {};
  const r2 = (x: number) => Math.round(x * 100) / 100;
  for (const uni of ["momentum", "core"] as Universe[]) {
    const trades: Record<string, PricedTrade[]> = {};
    for (const [name, id] of Object.entries(ids[uni])) {
      trades[name] = priced(id);
      const row = JSON.parse(readFileSync(path.join(DATA_DIR, `${id}.trades.json`), "utf8")).row;
      const recostUsd = trades[name].reduce((a, t) => a + t.netUsd, 0);
      if (Math.abs(recostUsd - row.netPnl) > 0.02) throw new Error(`${name}/${uni}: recost ${recostUsd} vs engine ${row.netPnl}`);
    }
    const test2: Record<string, unknown> = {};
    for (const [name, ts] of Object.entries(trades)) {
      const ci = tradeBootstrapCI(ts);
      test2[name] = { trades: ci.n, netBps: r2(ci.point), ci90: [r2(ci.lo), r2(ci.hi)], label: profitLabel(ci, uni) };
    }
    const test1: Record<string, unknown> = {};
    for (const [child, parent] of [["L2", "F1"], ["L4", "F3"]]) {
      if (!trades[child] || !trades[parent]) continue;
      const m = matchedShare(trades[parent], trades[child]);
      test1[`${child} vs ${parent}`] = { ...m, meanDiff: r2(m.meanDiff), label: holdLabel(m.share, m.pairs, uni) };
    }
    out[uni] = { test1, test2 };
    console.log(uni, JSON.stringify({ test1, test2 }));
  }
  const mom = (out.momentum as { test2: Record<string, { label: ProfitLabel }> }).test2;
  out.success = success(mom);
  console.log("SUCCESS (L2 or F3 profitable on Momentum):", out.success);
  writeFileSync(path.join(DATA_DIR, "stage3-results.json"), JSON.stringify(out, null, 1));
}

if (require.main === module) main();
