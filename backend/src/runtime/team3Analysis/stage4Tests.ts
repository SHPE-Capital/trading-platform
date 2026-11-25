/**
 * runtime/team3Analysis/stage4Tests.ts
 *
 * Stage 4 (external validation) tests, pre-registered in docs/team3/ablation.md "Stage 4 pre-registration"
 * before any Stage 4 run. Same tests as Stage 3 (stage3Tests.ts), applied per cell:
 *   cells   4a (expanded 25 + SPY, 2026-09-01 -> 11-20) and T1..T4 (Momentum, the four quarters before IS)
 *   Test 2  90% trade bootstrap of net bps/trade per cell, plus 4b pooled (T1..T4 trades together)
 *   Test 1  L2 vs F1 matched share per cell (L4 vs F3 secondary)
 *   Test 3  C3 vs V4 day bootstrap: team3Bootstrap.ts <V4> <C3> --stage3 (no code here)
 *   Earnings  L2 net bps/trade on earnings-day entries vs the rest (docs/team3/stage4/earnings.json)
 *   Cap     capBlocked / entryAttempts per run (TEAM3_ROW)
 * Verdict: verdict() below, exactly as pre-registered.
 *
 * Usage (from backend/): npx ts-node --transpile-only src/runtime/team3Analysis/stage4Tests.ts <stage4-ids.json>
 *   ids.json = {"4a": {"L2": "<id>", "F1": ..., "V4": ..., "F3": ..., "L4": ..., "C3": ...}, "T1": {...}, ...}
 * Writes tmp/team3-data/stage4-results.json (gitignored).
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { DATA_DIR } from "./validate";
import { holdLabel, matchedShare, priced, profitLabel, ratioBps, tradeBootstrapCI, type PricedTrade, type ProfitLabel } from "./stage3Tests";
import { EARNINGS_PATH } from "./earnings";
import { newYorkDay } from "../../strategies/team3Reversal/session";

export const CELLS = ["4a", "T1", "T2", "T3", "T4"] as const;
export type Cell = (typeof CELLS)[number];
export const WINDOWS_4B: Cell[] = ["T1", "T2", "T3", "T4"];
/** Minimum trades for any Stage 4 label: 10, as on Momentum in Stage 3. */
export const MIN = "momentum" as const;
export const CAP_FLAG = 0.05;

export type Verdict = "general" | "specific to Momentum names" | "specific to recent conditions" | "Stage 3 likely luck" | "mixed";

/** A 4b window "works" if L2's net bps/trade point estimate is > 0 with >= 10 trades. */
export const works = (r: { n: number; point: number }): boolean => r.n >= 10 && r.point > 0;

/** The pre-registered reading, first rule that applies. */
export function verdict(a4: ProfitLabel, windows: Record<string, boolean>, pooled4b: ProfitLabel): Verdict {
  const nWork = WINDOWS_4B.filter((w) => windows[w]).length;
  const aOk = a4 === "profitable";
  const bOk = nWork >= 3 && pooled4b === "profitable";
  if (aOk && bOk) return "general";
  if (bOk && !aOk) return "specific to Momentum names";
  if (aOk && nWork < 3 && windows.T4) return "specific to recent conditions";
  if (!aOk && nWork <= 1) return "Stage 3 likely luck";
  return "mixed";
}

export type Tagged = PricedTrade & { earnings: boolean };

/** Tags a trade (key "SYM@entryTs") as earnings if its ET entry day is one of the symbol's earnings days. */
export function tagEarnings(trades: readonly PricedTrade[], days: Record<string, readonly string[]>): Tagged[] {
  const sets = new Map(Object.entries(days).map(([s, d]) => [s, new Set(d)]));
  return trades.map((t) => {
    const [sym, ts] = t.key.split("@");
    return { ...t, earnings: !!sets.get(sym)?.has(newYorkDay(Number(ts))) };
  });
}

export function earningsSplit(trades: readonly Tagged[]) {
  const e = trades.filter((t) => t.earnings), x = trades.filter((t) => !t.earnings);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const all = ratioBps(trades), non = ratioBps(x);
  return {
    trades: trades.length, earningsTrades: e.length,
    allBps: r2(all), earningsBps: e.length ? r2(ratioBps(e)) : null, nonEarningsBps: x.length ? r2(non) : null,
    mostlyEarnings: all > 0 && !(non > 0),
  };
}

function main(): void {
  const file = process.argv[2];
  if (!file) throw new Error("usage: stage4Tests.ts <stage4-ids.json>");
  const ids = JSON.parse(readFileSync(file, "utf8")) as Record<Cell, Record<string, string>>;
  if (!existsSync(EARNINGS_PATH)) throw new Error(`missing ${EARNINGS_PATH}: run earnings.ts first`);
  const earn = JSON.parse(readFileSync(EARNINGS_PATH, "utf8")).symbols as Record<string, { days: string[] }>;
  const days = Object.fromEntries(Object.entries(earn).map(([s, v]) => [s, v.days]));
  const r2 = (x: number) => Math.round(x * 100) / 100;

  const out: Record<string, unknown> = {};
  const trades: Partial<Record<Cell, Record<string, PricedTrade[]>>> = {};
  for (const cell of CELLS) {
    const t: Record<string, PricedTrade[]> = {};
    const test2: Record<string, unknown> = {}, cap: Record<string, unknown> = {};
    for (const [name, id] of Object.entries(ids[cell])) {
      t[name] = priced(id);
      const row = JSON.parse(readFileSync(path.join(DATA_DIR, `${id}.trades.json`), "utf8")).row;
      const recostUsd = t[name].reduce((a, x) => a + x.netUsd, 0);
      if (Math.abs(recostUsd - row.netPnl) > 0.02) throw new Error(`${name}/${cell}: recost ${recostUsd} vs engine ${row.netPnl}`);
      const ci = tradeBootstrapCI(t[name]);
      test2[name] = { trades: ci.n, netBps: r2(ci.point), ci90: [r2(ci.lo), r2(ci.hi)], label: profitLabel(ci, MIN), netUsd: row.netPnl, maxDdUsd: row.maxDdUsd };
      const share = row.entryAttempts ? row.capBlocked / row.entryAttempts : 0;
      cap[name] = { capBlocked: row.capBlocked, entryAttempts: row.entryAttempts, share: r2(share * 100) / 100, flagged: share > CAP_FLAG };
    }
    const test1: Record<string, unknown> = {};
    for (const [child, parent] of [["L2", "F1"], ["L4", "F3"]]) {
      if (!t[child] || !t[parent]) continue;
      const m = matchedShare(t[parent], t[child]);
      test1[`${child} vs ${parent}`] = { ...m, meanDiff: r2(m.meanDiff), label: holdLabel(m.share, m.pairs, MIN) };
    }
    trades[cell] = t;
    out[cell] = { test2, test1, cap, earnings: t.L2 ? earningsSplit(tagEarnings(t.L2, days)) : null };
    console.log(cell, JSON.stringify(out[cell]));
  }

  // 4b pooled: every window's trades together, per config.
  const pooled: Record<string, unknown> = {};
  for (const name of Object.keys(ids.T1)) {
    const all = WINDOWS_4B.flatMap((w) => trades[w]![name] ?? []);
    const ci = tradeBootstrapCI(all);
    pooled[name] = { trades: ci.n, netBps: r2(ci.point), ci90: [r2(ci.lo), r2(ci.hi)], label: profitLabel(ci, MIN) };
  }
  const l2b = WINDOWS_4B.flatMap((w) => trades[w]!.L2);
  out.pooled4b = { test2: pooled, earnings: earningsSplit(tagEarnings(l2b, days)) };
  console.log("pooled4b", JSON.stringify(out.pooled4b));

  const l2 = (c: Cell) => { const ci = tradeBootstrapCI(trades[c]!.L2); return { n: ci.n, point: ci.point, label: profitLabel(ci, MIN) }; };
  const windows = Object.fromEntries(WINDOWS_4B.map((w) => [w, works(l2(w))]));
  const v = verdict(l2("4a").label, windows, (pooled.L2 as { label: ProfitLabel }).label);
  out.verdict = { a4: l2("4a").label, windowsWork: windows, nWork: Object.values(windows).filter(Boolean).length, pooled4b: (pooled.L2 as { label: ProfitLabel }).label, verdict: v };
  console.log("VERDICT", JSON.stringify(out.verdict));
  writeFileSync(path.join(DATA_DIR, "stage4-results.json"), JSON.stringify(out, null, 2));
}

if (require.main === module) main();
