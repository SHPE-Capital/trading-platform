/**
 * runtime/team3Analysis/holdSweep.ts
 *
 * Offline maxHoldBars sweep (0 configs): re-exit every dumped trade of a parent run with a different
 * time stop, entries held fixed. Uses sim.ts simulateExit (same exitReason, VWAP target, stopZ and the
 * pre-close flatten as the engine).
 *
 * Parity: at H = 30 the sim must reproduce each parent's trades exactly (count, reason, exit bar,
 * barsHeld, gross bps vs the dump's entryFill). If any trade differs, main() stops and reports.
 *
 * Gross reported = fill-to-fill at raw next opens (the zero-cost definition); net = gross - 14.2 bps.
 * Caveat: entries are fixed. With one position per symbol a longer hold blocks later entries, so real
 * trade counts fall.
 *
 * Usage (from backend/): npx ts-node --transpile-only src/runtime/team3Analysis/holdSweep.ts
 * Writes tmp/team3-data/hold-sweep.json (gitignored). In-sample dumps only, one in memory at a time.
 */

import { writeFileSync } from "fs";
import path from "path";
import { buildSeries, simulateExit, type Reason, type SessionSeries, type SimTrade } from "./sim";
import { BAR_MS, DATA_DIR, loadDump, type DumpTrip } from "./validate";
import { HALF_SPLIT } from "./evaluate";

export const ROUND_TRIP_BPS = 14.2;
export const HOLDS = [30, 35, 40, 45, 50, 60, 75, 90, 105, 120, 150, 180];
export const FOLLOW = [60, 120, 100_000] as const; // 100_000 = time stop off (exit at target, stop or the close flatten)
export const STOP_Z = 3.5;

export const PARENTS: Record<string, { momentum: string; core: string }> = {
  V4: { momentum: "bab63751-fcad-4088-ad02-6c3019d66cb2", core: "5a7cd486-dc60-4159-a1dd-88049fb61bb0" },
  F1: { momentum: "2a628992-074b-4673-aabe-06555b13792a", core: "9756c285-ffa2-4dcf-9fb4-3c53a97ba6cd" },
  F3: { momentum: "f27874dd-8c1e-4898-b908-56e8c108d2d3", core: "d47f1ca0-71a9-4901-8ff3-4d36e88f31a1" },
  C3: { momentum: "990a5e75-c896-48db-b7b4-daa97e865ce4", core: "4a40e3df-cd9d-46a5-a8ff-7df21f3b28f3" },
};

export interface FixedEntry { symbol: string; day: string; i: number; sign: 1 | -1; trip: DumpTrip }

/** Maps a dumped trade to its decision bar. null if the bar isn't in the series. */
export function toEntry(series: Map<string, SessionSeries>, t: DumpTrip): FixedEntry | null {
  const s = series.get(t.symbol);
  const i = s?.index.get(t.entryTs - BAR_MS);
  if (!s || i === undefined) return null;
  return { symbol: t.symbol, day: s.day[i], i, sign: t.side === "buy" ? 1 : -1, trip: t };
}

/** Exact parity of one trade at the parent's own exit config: reason, exit bar, barsHeld, gross vs entryFill. */
export function parityOk(s: SessionSeries, e: FixedEntry, sim: SimTrade | null): string | null {
  if (!sim) return "no exit";
  const t = e.trip;
  if (sim.reason !== t.reason) return `reason ${sim.reason} vs ${t.reason}`;
  if (s.ts[sim.exitIdx] + BAR_MS !== t.exitTs) return `exit bar ${s.ts[sim.exitIdx] + BAR_MS} vs ${t.exitTs}`;
  if (sim.barsHeld !== t.barsHeld) return `barsHeld ${sim.barsHeld} vs ${t.barsHeld}`;
  const g = (e.sign * (s.close[sim.exitIdx] - t.entryFill) / t.entryFill) * 10_000;
  if (Math.abs(g - t.pnlBpsGross) > 1e-6) return `gross ${g} vs ${t.pnlBpsGross}`;
  return null;
}

export interface Cell {
  trades: number;
  mix: Record<Reason, number>;
  grossBps: number;
  netBps: number;
  timeGrossBps: number | null;
  p5GrossBps: number | null;
  p5NetBps: number | null;
  avgBars: number;
}

export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

export function summarizeCell(trades: SimTrade[]): Cell {
  const mix: Record<Reason, number> = { target: 0, time: 0, stop: 0, close: 0 };
  const g = trades.map((t) => t.grossFillBps);
  const time = trades.filter((t) => t.reason === "time").map((t) => t.grossFillBps);
  for (const t of trades) mix[t.reason]++;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const p5 = quantile(g, 0.05);
  return {
    trades: trades.length, mix,
    grossBps: mean(g), netBps: mean(g) - ROUND_TRIP_BPS,
    timeGrossBps: time.length ? mean(time) : null,
    p5GrossBps: p5, p5NetBps: p5 === null ? null : p5 - ROUND_TRIP_BPS,
    avgBars: mean(trades.map((t) => t.barsHeld)),
  };
}

/** Of the trades time-stopped at 30: where each would end with a longer (or no) time stop. */
export function followUp(series: Map<string, SessionSeries>, timed: FixedEntry[]): Record<string, Record<Reason, number>> {
  const out: Record<string, Record<Reason, number>> = {};
  for (const h of FOLLOW) {
    const mix: Record<Reason, number> = { target: 0, time: 0, stop: 0, close: 0 };
    for (const e of timed) {
      const sim = simulateExit(series.get(e.symbol)!, e.i, e.sign, { stopZ: STOP_Z, maxHoldBars: h });
      if (sim) mix[sim.reason]++;
    }
    out[h === 100_000 ? "close" : String(h)] = mix;
  }
  return out;
}

export type Half = "all" | "first" | "second";
export const inHalf = (day: string, h: Half): boolean => h === "all" || (h === "first" ? day <= HALF_SPLIT : day > HALF_SPLIT);

/** Sweeps one parent run. Throws on any parity failure at H = 30. */
export function sweepDump(series: Map<string, SessionSeries>, trips: DumpTrip[], holds = HOLDS) {
  const entries: FixedEntry[] = [];
  const failures: string[] = [];
  for (const t of trips) {
    const e = toEntry(series, t);
    if (!e) { failures.push(`${t.symbol}@${t.entryTs}: entry bar missing`); continue; }
    const why = parityOk(series.get(e.symbol)!, e, simulateExit(series.get(e.symbol)!, e.i, e.sign, { stopZ: STOP_Z, maxHoldBars: 30 }));
    if (why) failures.push(`${t.symbol}@${t.entryTs}: ${why}`);
    entries.push(e);
  }
  if (failures.length) throw new Error(`parity at H=30 failed on ${failures.length}/${trips.length}: ${failures.slice(0, 5).join("; ")}`);
  const cells: Record<Half, Record<number, Cell>> = { all: {}, first: {}, second: {} };
  const timed: Record<Half, FixedEntry[]> = { all: [], first: [], second: [] };
  for (const h of holds) {
    const sims = entries.map((e) => ({ e, sim: simulateExit(series.get(e.symbol)!, e.i, e.sign, { stopZ: STOP_Z, maxHoldBars: h })! }));
    for (const half of ["all", "first", "second"] as Half[]) {
      const part = sims.filter((x) => inHalf(x.e.day, half));
      cells[half][h] = summarizeCell(part.map((x) => x.sim));
      if (h === 30) timed[half] = part.filter((x) => x.sim.reason === "time").map((x) => x.e);
    }
  }
  const follow = Object.fromEntries((["all", "first", "second"] as Half[]).map((h) => [h, { n: timed[h].length, ...followUp(series, timed[h]) }]));
  return { trades: trips.length, cells, follow };
}

function main(): void {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, ids] of Object.entries(PARENTS)) {
    for (const uni of ["momentum", "core"] as const) {
      const d = loadDump(ids[uni]);
      const series = new Map(d.symbols.map((s) => [s, buildSeries(s, d.bars[s])]));
      try {
        (out[name] ??= {})[uni] = sweepDump(series, d.roundTrips);
        console.log(name, uni, "parity ok:", d.roundTrips.length, "trades");
      } catch (err) {
        console.error(name, uni, String(err));
        process.exit(1);
      }
    }
  }
  writeFileSync(path.join(DATA_DIR, "hold-sweep.json"), JSON.stringify(out, null, 1));
  console.log("wrote", path.join(DATA_DIR, "hold-sweep.json"));
}

if (require.main === module) main();
