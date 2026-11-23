/**
 * runtime/team3Analysis/evaluate.ts
 *
 * Step 2 of the signal series (ablation.md "Signal series F3-F5"): engine-feasible
 * simulation of an entry condition set, validated against the real F1/F2 engine runs, then the
 * pre-registered ranking of the flagged set (b) groups.
 *
 * Engine-feasible = one position per symbol, chronological: an entry is only allowed on a bar after
 * the previous trade's exit signal bar (its exit fills at that next bar's open, and the engine decides
 * on that same bar). Entry fill at the next raw bar's open, baseline exits (sim.ts simulateExit),
 * protocol costs: 5 bps slippage + 2 bps half spread per side, $0.005/share, shares = floor(5000 / close).
 * bps/trade = sum net $ / traded notional (entry side = half of all fill notional), as team3Backtest.ts.
 *
 * Usage (from backend/): npx ts-node --transpile-only src/runtime/team3Analysis/evaluate.ts
 * Writes tmp/team3-data/eval-results.json (gitignored). In-sample dumps only. One dump in memory at a time.
 */

import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { buildSeries, isOpportunity, simulateExit, v4Entry, V4_EXIT, type ExitCfg, type SessionSeries } from "./sim";
import { FEATURES, binOf, featuresAt, type BinSpec, type Ctx, type FeatureRow } from "./features";
import { BAR_MS, DATA_DIR, DUMPS, loadDump, type DumpTrip } from "./validate";

/** The engine applies slippage and half spread as two multiplicative steps: price * (1 + 5 bps) * (1 + 2 bps) for a buy. */
export const COST = { slippageBps: 5, halfSpreadBps: 2, commissionPerShare: 0.005, tradeUsd: 5_000 };
export const HALF_SPLIT = "2026-09-23";

/** Entry decision on session bar i: +1 long, -1 short, 0 none. */
export type EntryFn = (s: SessionSeries, i: number) => 1 | -1 | 0;

export interface EvalTrade {
  symbol: string; day: string; entryTs: number; exitTs: number; side: 1 | -1; reason: string; barsHeld: number;
  qty: number; entryFill: number; exitFill: number; netUsd: number; notional: number; grossBps: number;
}

/** Protocol cost math for one round trip. rawEntry/rawExit = the next-open prices before slippage. */
export function costTrade(side: 1 | -1, signalClose: number, rawEntry: number, rawExit: number, c = COST): { qty: number; entryFill: number; exitFill: number; netUsd: number; notional: number; grossBps: number } {
  const qty = Math.floor(c.tradeUsd / signalClose);
  const adj = (px: number, dir: number): number => px * (1 + (dir * c.slippageBps) / 10_000) * (1 + (dir * c.halfSpreadBps) / 10_000);
  const entryFill = adj(rawEntry, side);
  const exitFill = adj(rawExit, -side);
  const netUsd = side * qty * (exitFill - entryFill) - 2 * c.commissionPerShare * qty;
  const notional = (qty * (entryFill + exitFill)) / 2;
  return { qty, entryFill, exitFill, netUsd, notional, grossBps: (side * (rawExit - rawEntry) / rawEntry) * 10_000 };
}

/** One-position walk over one symbol's session series. */
export function walkSymbol(s: SessionSeries, entry: EntryFn, exit: ExitCfg = V4_EXIT): EvalTrade[] {
  const out: EvalTrade[] = [];
  let free = 0;
  for (let i = 0; i < s.n; i++) {
    if (i < free) continue;
    const side = entry(s, i);
    if (!side) continue;
    const sim = simulateExit(s, i, side, exit);
    if (!sim) continue;
    const k = sim.exitIdx;
    const rawExit = s.nextOpen[k] > 0 ? s.nextOpen[k] : s.close[k];
    const c = costTrade(side, s.close[i], sim.fill, rawExit);
    if (c.qty <= 0) continue;
    out.push({ symbol: s.symbol, day: s.day[i], entryTs: s.ts[i], exitTs: s.ts[k], side, reason: sim.reason, barsHeld: sim.barsHeld, ...c });
    free = k + 1;
  }
  return out;
}

export interface Summary { trades: number; netBps: number; grossBps: number; netUsd: number; halves: [number, number]; halfN: [number, number]; days: number; bestDayShare: number }

const aggBps = (ts: readonly EvalTrade[]): number => {
  const n = ts.reduce((a, t) => a + t.notional, 0);
  return n > 0 ? (ts.reduce((a, t) => a + t.netUsd, 0) / n) * 10_000 : NaN;
};

export function summarize(ts: readonly EvalTrade[]): Summary {
  const h = [ts.filter((t) => t.day <= HALF_SPLIT), ts.filter((t) => t.day > HALF_SPLIT)];
  const byDay = new Map<string, number>();
  for (const t of ts) byDay.set(t.day, (byDay.get(t.day) ?? 0) + t.grossBps);
  const sum = ts.reduce((a, t) => a + t.grossBps, 0);
  const best = Math.max(...byDay.values());
  return {
    trades: ts.length, netBps: aggBps(ts), grossBps: ts.length ? sum / ts.length : NaN, netUsd: ts.reduce((a, t) => a + t.netUsd, 0),
    halves: [aggBps(h[0]), aggBps(h[1])], halfN: [h[0].length, h[1].length], days: byDay.size,
    bestDayShare: sum > 0 ? best / sum : NaN,
  };
}

// ---------- conditions ----------

let binsCache: BinSpec[] | null = null;
/** The S4 bins (tmp/team3-data/s4-bins.json), read on first use. */
const bins = (): BinSpec[] => (binsCache ??= JSON.parse(readFileSync(path.join(DATA_DIR, "s4-bins.json"), "utf8")));

/** Opportunity side (1.5 <= |z| < 3.5, entry window, side from z, edge >= 0), never the benchmark. */
const opp = (s: SessionSeries, i: number): 1 | -1 | 0 => (s.symbol === "SPY" ? 0 : isOpportunity(s, i));

/** Per-universe feature cache for opportunity bars. */
class FeatureCache {
  private m = new Map<string, FeatureRow>();
  constructor(private ctx: Ctx) {}
  at(s: SessionSeries, i: number, sign: number): FeatureRow {
    const k = `${s.symbol}@${i}`;
    let f = this.m.get(k);
    if (!f) { f = featuresAt(s, i, sign, this.ctx); this.m.set(k, f); }
    return f;
  }
}

export type GroupSpec = Array<{ feature: string; bin: number }>;

/** Parses "feat=label & feat=label" against the bins' labels. */
export function parseGroup(label: string): GroupSpec {
  return label.split(" & ").map((part) => {
    const eq = part.indexOf("=");
    const feature = part.slice(0, eq), lab = part.slice(eq + 1);
    const spec = bins().find((b) => b.feature === feature)!;
    const bin = spec.labels.indexOf(lab);
    if (bin < 0) throw new Error(`bad label ${part}`);
    return { feature, bin };
  });
}

function groupEntry(g: GroupSpec, fc: FeatureCache): EntryFn {
  return (s, i) => {
    const sign = opp(s, i);
    if (!sign) return 0;
    const f = fc.at(s, i, sign);
    return g.every(({ feature, bin }) => binOf(bins()[FEATURES.indexOf(feature as never)], f[feature as keyof FeatureRow]) === bin) ? sign : 0;
  };
}

/** F1 as the engine runs it (spyDivergenceIdea): SPY |z| >= 1 opposite sign, crossings 1..2. */
const f1Entry = (fc: FeatureCache): EntryFn => (s, i) => {
  const sign = opp(s, i);
  if (!sign) return 0;
  const f = fc.at(s, i, sign);
  return f.spySameSide === 0 && f.crossings60 >= 1 && f.crossings60 <= 2 ? sign : 0;
};
/** F2 as the engine runs it (ownQuietIdea): own share > 0.945, day move <= 47.1 bps. */
const f2Entry = (fc: FeatureCache): EntryFn => (s, i) => {
  const sign = opp(s, i);
  if (!sign) return 0;
  const f = fc.at(s, i, sign);
  return f.ownShare > 0.945 && f.trendBps <= 47.1 ? sign : 0;
};
const v4 = (): EntryFn => (s, i) => v4Entry(s, i);

// ---------- run ----------

const RUNS = {
  momentum: { F1: "2a628992-074b-4673-aabe-06555b13792a", F2: "952a5479-db3d-42d7-8f3e-f4f0b6de8708", V4: DUMPS.momentum.cost },
  core: { F1: "9756c285-ffa2-4dcf-9fb4-3c53a97ba6cd", F2: "d349db3d-6d57-4be0-9978-4eb847a4b8af", V4: DUMPS.core.cost },
} as const;

function flaggedLabels(): string[] {
  const md = readFileSync(path.resolve(__dirname, "../../../../docs/team3/results/strategy-survey.md"), "utf8").split(/\r?\n/);
  const start = md.findIndex((l) => l.startsWith("### Flagged, set (b)"));
  const out: string[] = [];
  for (let k = start + 1; k < md.length && !md[k].startsWith("###"); k++) {
    const l = md[k];
    if (l.startsWith("| ") && !l.startsWith("| Group")) out.push(l.split("|")[1].trim());
  }
  return out;
}

const F1_GROUP = "crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1)";
const F2_GROUP = "ownShare=> 0.945 & trendBps=<= 47.1";

function compare(sim: EvalTrade[], real: DumpTrip[]): Record<string, unknown> {
  const key = (sym: string, ts: number) => `${sym}@${ts}`;
  const simK = new Map(sim.map((t) => [key(t.symbol, t.entryTs + BAR_MS), t]));
  const realK = new Set(real.map((t) => key(t.symbol, t.entryTs)));
  let matched = 0, exitMatch = 0, fillMatch = 0;
  for (const t of real) {
    const s = simK.get(key(t.symbol, t.entryTs));
    if (!s) continue;
    matched++;
    if (s.exitTs + BAR_MS === t.exitTs) exitMatch++;
    if (Math.abs(s.entryFill - t.entryFill) < 1e-9 * t.entryFill) fillMatch++;
  }
  return {
    realTrades: real.length, simTrades: sim.length, matchedSymbolEntryTs: matched, exitTsMatch: exitMatch, entryFillMatch: fillMatch,
    onlyReal: real.filter((t) => !simK.has(key(t.symbol, t.entryTs))).slice(0, 5).map((t) => key(t.symbol, t.entryTs)),
    onlySim: sim.filter((t) => !realK.has(key(t.symbol, t.entryTs + BAR_MS))).slice(0, 5).map((t) => key(t.symbol, t.entryTs + BAR_MS)),
  };
}

function main(): void {
  const labels = flaggedLabels();
  const candidates = labels.filter((l) => l !== F1_GROUP && l !== F2_GROUP && !l.includes("crowded=yes"));
  const out: Record<string, any> = { flagged: labels.length, candidates, validation: {}, groups: {} };

  for (const uni of ["momentum", "core"] as const) {
    const ids = RUNS[uni];
    const realTrips: Record<string, { trips: DumpTrip[]; row: any }> = {};
    for (const [name, id] of Object.entries(ids)) {
      if (name === "F1") continue; // loaded last, its bars are kept
      const d = JSON.parse(readFileSync(path.join(DATA_DIR, `${id}.trades.json`), "utf8"));
      realTrips[name] = { trips: d.roundTrips, row: { trades: d.row.trades, avgBpsPerTrade: d.row.avgBpsPerTrade, netPnl: d.row.netPnl } };
    }
    let d: any = loadDump(ids.F1);
    const row = JSON.parse(readFileSync(path.join(DATA_DIR, `${ids.F1}.trades.json`), "utf8")).row;
    realTrips.F1 = { trips: d.roundTrips, row: { trades: row.trades, avgBpsPerTrade: row.avgBpsPerTrade, netPnl: row.netPnl } };
    const symbols: string[] = d.symbols;
    const all = new Map<string, SessionSeries>(symbols.map((s) => [s, buildSeries(s, d.bars[s])]));
    d = null;
    const ctx: Ctx = { all, spy: all.get("SPY")!, lookbackBars: 30, crowdZ: 2, crowdMin: 3, stretchZ: 1.5 };
    const fc = new FeatureCache(ctx);
    const run = (e: EntryFn, exit: ExitCfg = V4_EXIT): EvalTrade[] => [...all.values()].flatMap((s) => walkSymbol(s, e, exit));

    const entries: Record<string, EntryFn> = { V4: v4(), F1: f1Entry(fc), F2: f2Entry(fc) };
    for (const name of ["V4", "F1", "F2"]) {
      const sim = run(entries[name]);
      const sm = summarize(sim);
      out.validation[`${name}/${uni}`] = { engine: realTrips[name].row, sim: { trades: sm.trades, netBps: +sm.netBps.toFixed(2), netUsd: +sm.netUsd.toFixed(2) }, ...compare(sim, realTrips[name].trips) };
      console.log(name, uni, JSON.stringify(out.validation[`${name}/${uni}`]));
    }
    for (const l of candidates) {
      const sm = summarize(run(groupEntry(parseGroup(l), fc)));
      (out.groups[l] ??= {})[uni] = sm;
    }
    console.log(uni, "groups done");
  }

  // Ranking.
  const rows = candidates.map((l) => {
    const m: Summary = out.groups[l].momentum, c: Summary = out.groups[l].core;
    const miss: string[] = [];
    if (m.trades < 60) miss.push("Mom trades < 60");
    if (!(m.bestDayShare <= 0.3)) miss.push("best day > 30%");
    if (!(m.halves[0] >= 0 && m.halves[1] >= 0)) miss.push("a Mom half < 0");
    if (!(Math.sign(c.netBps) === Math.sign(m.netBps))) miss.push("Core sign differs");
    return { label: l, m, c, miss, spyNo: l.includes("spySameSide=no") };
  }).sort((a, b) => b.m.netBps - a.m.netBps);
  const selected: string[] = [];
  let spyNo = 0;
  for (const r of rows) {
    if (selected.length >= 3 || r.miss.length) continue;
    if (r.spyNo && spyNo >= 2) { r.miss.push("3rd SPY-opposite group (cap 2)"); continue; }
    selected.push(r.label); if (r.spyNo) spyNo++;
  }
  out.ranking = rows.map((r) => ({ label: r.label, miss: r.miss, momentum: r.m, core: r.c }));
  out.selected = selected;
  writeFileSync(path.join(DATA_DIR, "eval-results.json"), JSON.stringify(out, null, 1));
  console.log("selected", selected);
}

if (require.main === module) main();
