/**
 * runtime/team3Analysis/validate.ts
 *
 * Step 1 of the S4 survey: replay V4's zero-cost trades with sim.ts and compare.
 * Usage (from backend/): npx ts-node --transpile-only src/runtime/team3Analysis/validate.ts
 * Loads one dump at a time. In-sample dumps only.
 */

import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { buildSeries, simulateExit, v4Entry, edgeBps, type RawBar, type SessionSeries } from "./sim";

export const DATA_DIR = path.resolve(__dirname, "../../../tmp/team3-data");
/** A dump's signal ts is the decision bar's END (bar start + 1 min), not the bar ts the INDEX says. */
export const BAR_MS = 60_000;
export const DUMPS = {
  momentum: { cost: "bab63751-fcad-4088-ad02-6c3019d66cb2", zero: "2af1685c-5af1-47f2-bb21-aede6fcdfab6" },
  core: { cost: "5a7cd486-dc60-4159-a1dd-88049fb61bb0", zero: "cbb3b46d-3d57-4b0d-b859-6d2a258d195e" },
} as const;

export interface DumpTrip { symbol: string; side: "buy" | "sell"; entryTs: number; exitTs: number; entryFill: number; entryZ: number; reason: string; barsHeld: number; pnlBpsGross: number }
export interface Dump { symbols: string[]; roundTrips: DumpTrip[]; bars: Record<string, RawBar[]> }

export function loadDump(id: string): Dump {
  const d = JSON.parse(readFileSync(path.join(DATA_DIR, `${id}.trades.json`), "utf8"));
  return { symbols: d.symbols, roundTrips: d.roundTrips, bars: d.bars };
}

function main(): void {
  const out: Record<string, unknown> = {};
  for (const [uni, ids] of Object.entries(DUMPS)) {
    const d = loadDump(ids.zero);
    const series = new Map<string, SessionSeries>(d.symbols.map((s) => [s, buildSeries(s, d.bars[s])]));
    let n = 0, found = 0, ruleOk = 0, zOk = 0, fillOk = 0, exitOk = 0, reasonOk = 0, within05 = 0, within1 = 0;
    let absClose = 0, absFill = 0, diffFill = 0;
    const bad: unknown[] = [];
    for (const t of d.roundTrips) {
      n++;
      const s = series.get(t.symbol)!;
      const i = s.index.get(t.entryTs - BAR_MS);
      if (i === undefined) { bad.push({ t, why: "no bar" }); continue; }
      found++;
      const sign = t.side === "buy" ? 1 : -1;
      if (v4Entry(s, i) === sign) ruleOk++;
      if (Math.abs(s.z[i] - t.entryZ) < 1e-9) zOk++;
      const sim = simulateExit(s, i, sign);
      if (!sim) { bad.push({ t, why: "no sim" }); continue; }
      if (Math.abs(sim.fill - t.entryFill) < 1e-9) fillOk++;
      if (s.ts[sim.exitIdx] + BAR_MS === t.exitTs) exitOk++;
      if (sim.reason === t.reason) reasonOk++;
      const dc = Math.abs(sim.grossCloseBps - t.pnlBpsGross);
      absClose += dc; absFill += Math.abs(sim.grossFillBps - t.pnlBpsGross); diffFill += sim.grossFillBps - t.pnlBpsGross;
      if (dc < 0.5) within05++;
      if (dc < 1) within1++;
      if (dc >= 0.5 && bad.length < 10) bad.push({ sym: t.symbol, entryTs: t.entryTs, v4: [t.reason, t.exitTs, t.pnlBpsGross, t.entryFill], sim: [sim.reason, s.ts[sim.exitIdx], sim.grossCloseBps, sim.fill], edge: edgeBps(s, i) });
    }
    out[uni] = {
      trades: n, entryBarFound: found, v4RuleHolds: ruleOk, entryZExact: zOk, entryFillExact: fillOk, exitTsMatch: exitOk, reasonMatch: reasonOk,
      grossCloseWithin05: within05, grossCloseWithin1: within1, madCloseBps: absClose / found, madNextOpenBps: absFill / found, meanNextOpenMinusV4: diffFill / found, bad,
    };
    console.log(uni, JSON.stringify(out[uni], null, 1));
  }
  writeFileSync(path.join(DATA_DIR, "s4-validation.json"), JSON.stringify(out, null, 1));
}

if (require.main === module) main();
