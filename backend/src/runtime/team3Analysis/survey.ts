/**
 * runtime/team3Analysis/survey.ts
 *
 * S4 strategy survey (offline, in-sample dumps only, no backtests, no rule changes).
 *   (a) V4 trade log: V4's real trades, edge = zero-cost pnlBpsGross.
 *   (b) opportunity log: every entry-window bar with 1.5 <= |z| < 3.5, fading the stretch,
 *       baseline exit simulated from bars (sim.ts, validated by validate.ts), exit at the next open, zero cost.
 * Then: 12 entry-time features, bins fixed from feature values only (written first),
 * group counts / mean edge per universe and half, flags, and shuffle nulls.
 *
 * Usage (from backend/): npx ts-node --transpile-only src/runtime/team3Analysis/survey.ts [shuffles=200]
 * Writes tmp/team3-data/s4-bins.json, s4-results.json and s4-tables.md (gitignored).
 */

import { writeFileSync } from "fs";
import path from "path";
import { buildSeries, isOpportunity, simulateExit, type SessionSeries } from "./sim";
import { FEATURES, binOf, featuresAt, terciles, type BinSpec, type Ctx, type FeatureRow } from "./features";
import {
  FLAG, circularShiftWithin, enumerateGroups, flagged, groupSums, membership, quantile, rankFeatures, rng,
  shuffleWithin, statOf, testedMask, type FlagRule, type Group, type Rec, type Sums,
} from "./groups";
import { BAR_MS, DATA_DIR, DUMPS, loadDump } from "./validate";

const HALF_SPLIT = "2026-09-23"; // first half: day <= this
const UNI = ["momentum", "core"] as const;

interface Row { u: 0 | 1; symbol: string; ts: number; day: string; f: FeatureRow; edge: number; reason: string }

function collect(): { a: Row[]; b: Row[]; checks: Record<string, unknown> } {
  const a: Row[] = [], b: Row[] = [], checks: Record<string, unknown> = {};
  UNI.forEach((name, u) => {
    // Cost dump first, only to confirm V4's trades are the same entries as the zero-cost twin's.
    const costKeys = new Set(loadDump(DUMPS[name].cost).roundTrips.map((t) => `${t.symbol}@${t.entryTs}`));
    const d = loadDump(DUMPS[name].zero);
    const all = new Map<string, SessionSeries>(d.symbols.map((s) => [s, buildSeries(s, d.bars[s])]));
    const ctx: Ctx = { all, spy: all.get("SPY")!, lookbackBars: 30, crowdZ: 2, crowdMin: 3, stretchZ: 1.5 };
    let matched = 0;
    for (const t of d.roundTrips) {
      if (costKeys.has(`${t.symbol}@${t.entryTs}`)) matched++;
      const s = all.get(t.symbol)!, i = s.index.get(t.entryTs - BAR_MS)!;
      const sign = t.side === "buy" ? 1 : -1;
      a.push({ u: u as 0 | 1, symbol: t.symbol, ts: s.ts[i], day: s.day[i], f: featuresAt(s, i, sign, ctx), edge: t.pnlBpsGross, reason: t.reason });
    }
    checks[name] = { costTrades: costKeys.size, zeroTrades: d.roundTrips.length, matchedBySymbolEntryTs: matched };
    let opp = 0, noFill = 0;
    for (const s of all.values()) {
      for (let i = 0; i < s.n; i++) {
        const sign = isOpportunity(s, i);
        if (!sign) continue;
        const sim = simulateExit(s, i, sign);
        if (!sim) { noFill++; continue; }
        opp++;
        b.push({ u: u as 0 | 1, symbol: s.symbol, ts: s.ts[i], day: s.day[i], f: featuresAt(s, i, sign, ctx), edge: sim.grossFillBps, reason: sim.reason });
      }
    }
    (checks[name] as Record<string, unknown>).opportunities = opp;
    (checks[name] as Record<string, unknown>).opportunitiesNoFill = noFill;
  });
  return { a, b, checks };
}

const fmt = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : "n/a");

/** Bins from the pooled opportunity log's feature values only (no outcomes read). */
function makeBins(rows: readonly Row[]): BinSpec[] {
  const INTEGER = new Set(["crossings60", "stretchRun"]);
  return FEATURES.map((feature): BinSpec => {
    if (feature === "turnBar" || feature === "crowded") return { feature, kind: "values", values: [0, 1], labels: ["no", "yes"] };
    if (feature === "timeOfDay") return { feature, kind: "values", values: [0, 1, 2], labels: ["open 9:45-11:44", "mid 11:45-13:44", "late 13:45-15:44"] };
    if (feature === "spySameSide") return { feature, kind: "values", values: [1, 0, 0.5], labels: ["yes (SPY same side, zSPY >= 1)", "no (SPY opposite, zSPY >= 1)", "neutral (SPY within 1 sigma)"] };
    let [c1, c2] = terciles(rows.map((r) => r.f[feature]));
    if (INTEGER.has(feature)) { c1 = Math.floor(c1); c2 = Math.floor(c2); }
    if (c2 <= c1) return { feature, kind: "cuts", cuts: [c1], labels: [`<= ${c1}`, `> ${c1}`] };
    if (INTEGER.has(feature)) return { feature, kind: "cuts", cuts: [c1, c2], labels: [`<= ${c1}`, `${c1 + 1}-${c2}`, `>= ${c2 + 1}`] };
    const d = feature === "edgeBps" || feature === "trendBps" ? 1 : 3;
    return { feature, kind: "cuts", cuts: [c1, c2], labels: [`<= ${fmt(c1, d)}`, `${fmt(c1, d)} - ${fmt(c2, d)}`, `> ${fmt(c2, d)}`] };
  });
}

const toRecs = (rows: readonly Row[], bins: readonly BinSpec[]): Rec[] => rows.map((r) => ({
  u: r.u, h: r.day <= HALF_SPLIT ? 0 : 1, edge: r.edge,
  bins: Int8Array.from(FEATURES.map((f, k) => binOf(bins[k], r.f[f]))),
}));

interface SetResult {
  groups: Group[]; tested: Uint8Array; sums: Sums; top4: number[]; spread: number[];
  flags: number[]; flagsCore50: number[]; nTested: number;
  nullCounts: { label: number[]; labelCore50: number[]; circ: number[]; circCore50: number[] };
  nullMomMean: { label: Float64Array[]; circ: Float64Array[] };
}

function countFlags(x: Sums, groups: readonly Group[], F: number, rule: FlagRule, mask?: Uint8Array): { list: number[]; tested: Uint8Array; top4: number[]; spread: number[] } {
  const { order, spread } = rankFeatures(x, groups, F);
  const top4 = order.slice(0, 4);
  const tested = mask ?? testedMask(groups, top4);
  const list: number[] = [];
  for (let g = 0; g < groups.length; g++) if (tested[g] && flagged(statOf(x, g), rule)) list.push(g);
  return { list, tested, top4, spread };
}

function analyse(recs: Rec[], shuffles: number, seed: number): SetResult {
  const F = FEATURES.length;
  const binsPer = FEATURES.map((_, k) => Math.max(...recs.map((r) => r.bins[k])) + 1);
  const groups = enumerateGroups(binsPer);
  const m = membership(recs, groups);
  const edges = recs.map((r) => r.edge);
  const sums = groupSums(recs, m, groups.length, edges);
  const real = countFlags(sums, groups, F, FLAG);
  const real50 = countFlags(sums, groups, F, { ...FLAG, minCoreN: 50 }, real.tested);
  const out: SetResult = {
    groups, tested: real.tested, sums, top4: real.top4, spread: real.spread, flags: real.list, flagsCore50: real50.list,
    nTested: real.tested.reduce((n, t) => n + t, 0),
    nullCounts: { label: [], labelCore50: [], circ: [], circCore50: [] }, nullMomMean: { label: [], circ: [] },
  };
  const rand = rng(seed);
  for (let k = 0; k < shuffles; k++) {
    for (const kind of ["label", "circ"] as const) {
      const e = kind === "label" ? shuffleWithin(recs, edges, rand) : circularShiftWithin(recs, edges, rand);
      const x = groupSums(recs, m, groups.length, e);
      const c = countFlags(x, groups, F, FLAG);                                // the shuffle picks its own top-4 for triples
      const c50 = countFlags(x, groups, F, { ...FLAG, minCoreN: 50 }, c.tested);
      out.nullCounts[kind].push(c.list.length);
      out.nullCounts[kind === "label" ? "labelCore50" : "circCore50"].push(c50.list.length);
      const mm = new Float64Array(groups.length);
      for (let g = 0; g < groups.length; g++) mm[g] = x.n[g * 2] > 0 ? x.s[g * 2] / x.n[g * 2] : NaN;
      out.nullMomMean[kind].push(mm);
    }
  }
  return out;
}

function main(): void {
  const shuffles = Number(process.argv[2] ?? 200);
  const { a, b, checks } = collect();
  console.log(JSON.stringify(checks));
  const bins = makeBins(b);
  writeFileSync(path.join(DATA_DIR, "s4-bins.json"), JSON.stringify(bins, null, 1));
  console.log("bins written before any outcome is read");

  const md: string[] = [];
  const results: Record<string, unknown> = { checks, bins };
  md.push("## Bins (fixed from the pooled opportunity log's feature values)\n");
  md.push("| # | Feature | Bin 0 | Bin 1 | Bin 2 |", "|---|---|---|---|---|");
  bins.forEach((s, k) => md.push(`| ${k + 1} | ${s.feature} | ${s.labels.join(" | ")}${s.labels.length < 3 ? " | -" : ""} |`));

  const label = (g: Group): string => g.map(([f, x]) => `${FEATURES[f]}=${bins[f].labels[x]}`).join(" & ");
  const row = (sr: SetResult, g: number, z?: { z: number; p: number; zc: number; pc: number }): string => {
    const st = statOf(sr.sums, g);
    return `| ${label(sr.groups[g])} | ${st.n[0]} | ${fmt(st.mean[0])} | ${fmt(st.halfMean[0])} (${st.halfN[0]}) | ${fmt(st.halfMean[1])} (${st.halfN[1]}) | ${st.n[1]} | ${fmt(st.mean[1])} | ${fmt(st.coreHalfMean[0])} / ${fmt(st.coreHalfMean[1])} |`
      + (z ? ` ${fmt(z.z)} | ${fmt(z.p, 3)} | ${fmt(z.zc)} | ${fmt(z.pc, 3)} |` : "");
  };
  const HEAD = "| Group | Mom n | Mom edge | Mom H1 (n) | Mom H2 (n) | Core n | Core edge | Core H1 / H2 |";
  const SEP = "|---|---|---|---|---|---|---|---|";

  for (const [setName, rows, seed] of [["a", a, 11], ["b", b, 22]] as const) {
    const recs = toRecs(rows, bins);
    const sr = analyse(recs, shuffles, seed);
    const all = [0, 1].map((u) => recs.filter((r) => r.u === u));
    const mean = (xs: Rec[]): number => xs.reduce((n, r) => n + r.edge, 0) / xs.length;
    md.push(`\n## Set (${setName}) ${setName === "a" ? "V4 trade log" : "opportunity log"}\n`);
    md.push(`All records: Momentum ${all[0].length} at ${fmt(mean(all[0]))} bps, Core ${all[1].length} at ${fmt(mean(all[1]))} bps.`
      + ` Halves Momentum ${fmt(mean(all[0].filter((r) => r.h === 0)))} / ${fmt(mean(all[0].filter((r) => r.h === 1)))}, Core ${fmt(mean(all[1].filter((r) => r.h === 0)))} / ${fmt(mean(all[1].filter((r) => r.h === 1)))}.\n`);
    md.push(`Feature spread (Momentum, max - min bin mean, bins with n >= 30): ${FEATURES.map((f, k) => `${f} ${fmt(sr.spread[k])}`).join(", ")}. Top 4: ${sr.top4.map((k) => FEATURES[k]).join(", ")}.\n`);
    md.push(`Groups tested: ${sr.nTested} (singles ${sr.groups.filter((g, i) => g.length === 1 && sr.tested[i]).length}, pairs ${sr.groups.filter((g, i) => g.length === 2 && sr.tested[i]).length}, triples ${sr.groups.filter((g, i) => g.length === 3 && sr.tested[i]).length}); non-empty (>= 1 record on either universe): ${sr.groups.filter((g, i) => sr.tested[i] && sr.sums.n[i * 2] + sr.sums.n[i * 2 + 1] > 0).length}; with Momentum n >= 50: ${sr.groups.filter((g, i) => sr.tested[i] && sr.sums.n[i * 2] >= 50).length}.\n`);

    md.push(`### Single features, set (${setName})\n`, HEAD, SEP);
    sr.groups.forEach((g, i) => { if (g.length === 1) md.push(row(sr, i)); });

    const top = (len: number, k: number): number[] => sr.groups.map((g, i) => i)
      .filter((i) => sr.groups[i].length === len && sr.tested[i] && sr.sums.n[i * 2] >= 50)
      .sort((x, y) => sr.sums.s[y * 2] / sr.sums.n[y * 2] - sr.sums.s[x * 2] / sr.sums.n[x * 2]).slice(0, k);
    md.push(`\n### Top 15 pairs by Momentum edge (Mom n >= 50), set (${setName})\n`, HEAD, SEP, ...top(2, 15).map((i) => row(sr, i)));
    md.push(`\n### Top 10 triples by Momentum edge (Mom n >= 50), set (${setName})\n`, HEAD, SEP, ...top(3, 10).map((i) => row(sr, i)));

    const zOf = (g: number): { z: number; p: number; zc: number; pc: number } => {
      const actual = statOf(sr.sums, g).mean[0];
      const one = (kind: "label" | "circ"): [number, number] => {
        const xs = sr.nullMomMean[kind].map((mm) => mm[g]).filter((x) => Number.isFinite(x));
        const mu = xs.reduce((n, x) => n + x, 0) / xs.length;
        const sd = Math.sqrt(xs.reduce((n, x) => n + (x - mu) ** 2, 0) / (xs.length - 1));
        return [(actual - mu) / sd, (1 + xs.filter((x) => x >= actual).length) / (xs.length + 1)];
      };
      const [z, p] = one("label"), [zc, pc] = one("circ");
      return { z, p, zc, pc };
    };
    const ZHEAD = HEAD + " z (label) | p (label) | z (circ) | p (circ) |", ZSEP = SEP + "---|---|---|---|";
    const flagTable = (list: number[]): string[] => list.map((g) => ({ g, z: zOf(g) })).sort((x, y) => y.z.z - x.z.z).map(({ g, z }) => row(sr, g, z));
    md.push(`\n### Flagged, set (${setName}): ${sr.flags.length} groups (Mom n >= 50, Mom edge >= 14, Core > 0, both Mom halves >= 0), ranked by z vs the label-shuffle null of the same group\n`);
    md.push(ZHEAD, ZSEP, ...flagTable(sr.flags));
    md.push(`\n### Flagged with Core n >= 50 too, set (${setName}): ${sr.flagsCore50.length} groups\n`, ZHEAD, ZSEP, ...flagTable(sr.flagsCore50));
    // Concentration: overlapping opportunities of one episode are not independent trades.
    md.push(`\n### Concentration of the flagged groups, set (${setName}), Momentum\n`);
    md.push("| Group | Mom n | days | symbol-days | runs (consecutive-bar episodes) | best day's share of edge sum | Mom edge without best day | Core days |", "|---|---|---|---|---|---|---|---|");
    for (const g of sr.flags) {
      const idx = recs.map((_, i) => i).filter((i) => recs[i].bins && sr.groups[g].every(([f, x]) => recs[i].bins[f] === x));
      const mom = idx.filter((i) => recs[i].u === 0), core = idx.filter((i) => recs[i].u === 1);
      const byDay = new Map<string, number>();
      for (const i of mom) byDay.set(rows[i].day, (byDay.get(rows[i].day) ?? 0) + rows[i].edge);
      const best = [...byDay.entries()].sort((p, q) => q[1] - p[1])[0];
      const total = mom.reduce((n, i) => n + rows[i].edge, 0);
      const rest = mom.filter((i) => rows[i].day !== best[0]);
      let runs = 0;
      mom.forEach((i, k) => { const p = mom[k - 1]; if (k === 0 || rows[p].symbol !== rows[i].symbol || rows[i].ts - rows[p].ts !== BAR_MS) runs++; });
      md.push(`| ${label(sr.groups[g])} | ${mom.length} | ${byDay.size} | ${new Set(mom.map((i) => `${rows[i].symbol}@${rows[i].day}`)).size} | ${runs} | ${fmt(best[1] / total, 2)} | ${fmt(rest.reduce((n, i) => n + rows[i].edge, 0) / rest.length)} | ${new Set(core.map((i) => rows[i].day)).size} |`);
    }
    const nc = sr.nullCounts;
    const desc = (xs: number[]): string => `mean ${fmt(xs.reduce((n, x) => n + x, 0) / xs.length)}, median ${fmt(quantile(xs, 0.5), 1)}, 95th pct ${fmt(quantile(xs, 0.95), 1)}, max ${Math.max(...xs)}, share of shuffles with >= actual`;
    md.push(`\n### Null, set (${setName}), ${shuffles} shuffles each\n`);
    md.push(`- Label shuffle, flags: ${desc(nc.label)} ${fmt(nc.label.filter((x) => x >= sr.flags.length).length / shuffles, 3)} (actual ${sr.flags.length})`);
    md.push(`- Label shuffle, flags with Core n >= 50: ${desc(nc.labelCore50)} ${fmt(nc.labelCore50.filter((x) => x >= sr.flagsCore50.length).length / shuffles, 3)} (actual ${sr.flagsCore50.length})`);
    md.push(`- Circular shift, flags: ${desc(nc.circ)} ${fmt(nc.circ.filter((x) => x >= sr.flags.length).length / shuffles, 3)} (actual ${sr.flags.length})`);
    md.push(`- Circular shift, flags with Core n >= 50: ${desc(nc.circCore50)} ${fmt(nc.circCore50.filter((x) => x >= sr.flagsCore50.length).length / shuffles, 3)} (actual ${sr.flagsCore50.length})`);
    results[setName] = {
      n: all.map((x) => x.length), mean: all.map(mean), top4: sr.top4.map((k) => FEATURES[k]), spread: sr.spread, nTested: sr.nTested,
      flags: sr.flags.map((g) => ({ group: label(sr.groups[g]), ...statOf(sr.sums, g), ...zOf(g) })),
      flagsCore50: sr.flagsCore50.map((g) => label(sr.groups[g])), nullCounts: nc,
    };
    console.log(`set ${setName}: tested ${sr.nTested}, flags ${sr.flags.length}, core50 ${sr.flagsCore50.length}`);
  }
  writeFileSync(path.join(DATA_DIR, "s4-results.json"), JSON.stringify(results, null, 1));
  writeFileSync(path.join(DATA_DIR, "s4-tables.md"), md.join("\n") + "\n");
}

if (require.main === module) main();
