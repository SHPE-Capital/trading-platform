/**
 * runtime/team3Analysis/selectUniverse.ts
 *
 * Stage 4a (out-of-universe) stock selection. Picks the 25 S&P 500 / Nasdaq-100 stocks that most
 * resemble the traded Momentum stocks (NVDA, AMD, MU, TSLA, META), using only Jun 1 -> Aug 31, 2026
 * 1-minute bars: no data from the test period (Sep 1 onward) and no strategy results.
 *
 * Pipeline (each step logged with the count left):
 *   0 pool       docs/team3/stage4/membership-2026-08-31.json (membershipSnapshot.ts)
 *   1 unused     drop the 11 symbols already used (TEAM3_GROUPS core + momentum)
 *   2 common     Alpaca asset is us_equity + tradable and not an ADR / registry share; share classes of
 *                one company (same CIK) keep the higher dollar volume
 *   3 price      mean daily session VWAP > $20
 *   4 dollar vol mean daily regular-session sum(close x volume) >= $1B (missing days count as 0)
 *   5 coverage   bars present / SPY's bars in the entry window (9:45-15:44 ET) >= 99%
 *   6 range      realized vol and beta to SPY inside the Momentum min-max, widened x0.75 / x1.25
 *   rank         Euclidean distance to the Momentum centroid over 5 z-scored features
 *                (z across the eligible pool): realized vol, log dollar volume, beta, correlation to SPY,
 *                VWAP-stretch frequency. Lowest first, ties alphabetical.
 *   select       walk the ranking, at most 8 per GICS sector, stop at 25. If fewer than 25: redo 4-select
 *                once with a $500M floor and report it. SPY appended as the benchmark (not traded).
 *
 * Features, all on regular-session bars inside the entry window (9:45-15:44 ET):
 *   realized vol  sample std of 1-minute log returns between consecutive minutes of the same day
 *   beta / corr   of those returns on SPY's return for the same minute
 *   stretch freq  share of entry-window bars with |z| >= 1.5 from session VWAP (the strategy's own
 *                 SessionVwapTracker, L2's divMinZ): how often the setup could occur, not whether it pays
 *
 * Determinism: symbols in sorted order, fixed summation order, fixed decimals, no run timestamp in the
 * output. --check runs the whole pipeline twice from scratch and compares SHA-256 of the outputs.
 *
 * Usage (from backend/):
 *   npx ts-node --transpile-only src/runtime/team3Analysis/selectUniverse.ts --check --write
 * Writes docs/team3/stage4/universe.{json,md}.
 */

import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { env } from "../../config/env";
import { alpacaGet } from "../../adapters/alpaca/rest";
import { RateLimiter } from "../../utils/rateLimiter";
import { SessionVwapTracker } from "../../strategies/team3Reversal/vwap";
import { inRegularSession, minutesSinceOpen, newYorkDay } from "../../strategies/team3Reversal/session";
import { TEAM3_GROUPS } from "../../strategies/team3Reversal/contract/protocol";
import { SNAPSHOT_PATH, type Member, type Snapshot } from "./membershipSnapshot";

// ---------------------------------------------------------------- rule constants (pre-set)

export const WINDOW = { start: "2026-06-01T00:00:00Z", end: "2026-08-31T23:59:59Z" };
export const USED = [...new Set([...TEAM3_GROUPS.core, ...TEAM3_GROUPS.momentum])].sort();
export const MOMENTUM = TEAM3_GROUPS.momentum.filter((s) => s !== "SPY").sort();
export const BENCHMARK = "SPY";
export const RULES = {
  minPrice: 20,
  minDollarVol: 1e9,
  fallbackDollarVol: 5e8,
  minCoverage: 0.99,
  /** Entry window, minutes since 9:30 ET: 9:45 (15) .. 15:44 (374) inclusive = 360 minutes. */
  entryFirstMin: 15,
  entryLastMin: 374,
  stretchZ: 1.5,
  crossWindow: 60,
  rangeLo: 0.75,
  rangeHi: 1.25,
  perSector: 8,
  take: 25,
  nearPct: 0.05,
  /** Coverage sits in [0.99, 1]; "within 5%" of the cutoff is read as within 5% of that 1-point band. */
  nearCoverage: 0.0005 * 5,
} as const;
const NOT_COMMON = /depositary|\bADR\b|registry shares|\bETF\b|\bETN\b/i;
const FEATURES = ["vol", "logDollarVol", "beta", "corr", "stretch"] as const;
type Feature = (typeof FEATURES)[number];

// ---------------------------------------------------------------- stats (pure)

export interface RawBar { t: string; o: number; h: number; l: number; c: number; v: number }

export interface Clock {
  /** SPY's entry-window bar count per New York day (the expected minutes). */
  expected: Map<string, number>;
  /** SPY 1-minute log return keyed by the later bar's start ms. */
  spyRet: Map<number, number>;
}

export interface Stats {
  symbol: string;
  days: number;
  price: number;
  dollarVol: number;
  coverage: number;
  vol: number;
  beta: number;
  corr: number;
  stretch: number;
  returns: number;
}

const inEntry = (ts: number): boolean => {
  const m = minutesSinceOpen(ts);
  return m >= RULES.entryFirstMin && m <= RULES.entryLastMin;
};

/** SPY bars -> the clock every other symbol is measured against. */
export function buildClock(spy: readonly RawBar[]): Clock {
  const expected = new Map<string, number>();
  const spyRet = new Map<number, number>();
  let prev: { ts: number; c: number } | null = null;
  for (const b of spy) {
    const ts = Date.parse(b.t);
    if (!inRegularSession(ts) || !inEntry(ts)) { prev = null; continue; }
    const day = newYorkDay(ts);
    expected.set(day, (expected.get(day) ?? 0) + 1);
    if (prev && ts - prev.ts === 60_000 && newYorkDay(prev.ts) === day) spyRet.set(ts, Math.log(b.c / prev.c));
    prev = { ts, c: b.c };
  }
  return { expected, spyRet };
}

/** One symbol's selection statistics over the window. Bars must be ascending. */
export function computeStats(symbol: string, bars: readonly RawBar[], clock: Clock): Stats {
  const vwap = new SessionVwapTracker();
  const dayPV = new Map<string, number>();
  const dayV = new Map<string, number>();
  const dayDollar = new Map<string, number>();
  let present = 0, zSeen = 0, zStretched = 0;
  let n = 0, s = 0, ss = 0;
  let pn = 0, px = 0, py = 0, pxx = 0, pyy = 0, pxy = 0;
  let prev: { ts: number; c: number } | null = null;

  for (const b of bars) {
    const ts = Date.parse(b.t);
    if (!inRegularSession(ts)) continue;
    const day = newYorkDay(ts);
    if (!clock.expected.has(day)) continue; // a day SPY did not trade a full entry window
    const typical = (b.h + b.l + b.c) / 3;
    dayPV.set(day, (dayPV.get(day) ?? 0) + typical * b.v);
    dayV.set(day, (dayV.get(day) ?? 0) + b.v);
    dayDollar.set(day, (dayDollar.get(day) ?? 0) + b.c * b.v);
    vwap.update({ ts, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v } as never);
    if (!inEntry(ts)) { prev = null; continue; }

    present += 1;
    const view = vwap.view(RULES.crossWindow);
    if (view && view.z !== null) {
      zSeen += 1;
      if (Math.abs(view.z) >= RULES.stretchZ) zStretched += 1;
    }
    if (prev && ts - prev.ts === 60_000 && newYorkDay(prev.ts) === day && prev.c > 0 && b.c > 0) {
      const r = Math.log(b.c / prev.c);
      n += 1; s += r; ss += r * r;
      const m = clock.spyRet.get(ts);
      if (m !== undefined) { pn += 1; px += m; py += r; pxx += m * m; pyy += r * r; pxy += m * r; }
    }
    prev = { ts, c: b.c };
  }

  const expectedDays = [...clock.expected.keys()].sort();
  const expectedMinutes = expectedDays.reduce((a, d) => a + clock.expected.get(d)!, 0);
  const tradedDays = expectedDays.filter((d) => (dayV.get(d) ?? 0) > 0);
  const price = tradedDays.length ? tradedDays.reduce((a, d) => a + dayPV.get(d)! / dayV.get(d)!, 0) / tradedDays.length : NaN;
  const dollarVol = expectedDays.reduce((a, d) => a + (dayDollar.get(d) ?? 0), 0) / expectedDays.length;
  const vol = n > 1 ? Math.sqrt(Math.max(0, (ss - (s * s) / n) / (n - 1))) : NaN;
  const cov = pn > 1 ? (pxy - (px * py) / pn) / (pn - 1) : NaN;
  const varM = pn > 1 ? (pxx - (px * px) / pn) / (pn - 1) : NaN;
  const varY = pn > 1 ? (pyy - (py * py) / pn) / (pn - 1) : NaN;
  return {
    symbol,
    days: tradedDays.length,
    price,
    dollarVol,
    coverage: expectedMinutes ? present / expectedMinutes : 0,
    vol,
    beta: cov / varM,
    corr: cov / Math.sqrt(varM * varY),
    stretch: zSeen ? zStretched / zSeen : NaN,
    returns: n,
  };
}

// ---------------------------------------------------------------- filter, rank, select (pure)

export interface AssetInfo { symbol: string; found: boolean; cls: string; tradable: boolean; name: string }

export interface Candidate extends Stats {
  sector: string;
  sectorSource: "gics" | "icb";
  cik: string | null;
  assetName: string;
  distance: number;
  z: Record<Feature, number>;
}

export interface Selection {
  dollarFloor: number;
  fallbackUsed: boolean;
  log: { step: string; left: number; removed: string[] }[];
  momentum: { stats: Stats[]; lo: Record<"vol" | "beta", number>; hi: Record<"vol" | "beta", number> };
  pool: { mean: Record<Feature, number>; sd: Record<Feature, number> };
  ranked: Candidate[];
  selected: Candidate[];
  skippedForSector: string[];
  /** Every symbol that passed steps 0-2, with the reason it later fell out (or "eligible"). */
  status: Map<string, string>;
}

const featureOf = (s: Stats, f: Feature): number => (f === "logDollarVol" ? Math.log(s.dollarVol) : s[f]);
const finite = (s: Stats): boolean => FEATURES.every((f) => Number.isFinite(featureOf(s, f))) && Number.isFinite(s.price);

/** Steps 1-2: the symbols statistics are needed for. Share-class dedup happens later, in select(). */
export function commonStock(members: readonly Member[], assets: ReadonlyMap<string, AssetInfo>) {
  // A used symbol excludes its whole company: other share classes (same CIK, e.g. GOOG for GOOGL) too.
  const usedCiks = new Set(members.filter((m) => USED.includes(m.ticker) && m.cik).map((m) => m.cik));
  const isUsed = (m: Member) => USED.includes(m.ticker) || (!!m.cik && usedCiks.has(m.cik));
  const afterUnused = members.filter((m) => !isUsed(m));
  const removedUsed = members.filter(isUsed).map((m) => m.ticker);
  const notCommon: string[] = [];
  const kept = afterUnused.filter((m) => {
    const a = assets.get(m.ticker);
    const ok = !!a && a.found && a.cls === "us_equity" && a.tradable && !NOT_COMMON.test(a.name);
    if (!ok) notCommon.push(m.ticker);
    return ok;
  });
  return { afterUnused, removedUsed, notCommon, kept };
}

export function select(
  members: readonly Member[],
  assets: ReadonlyMap<string, AssetInfo>,
  stats: ReadonlyMap<string, Stats>,
  dollarFloor: number = RULES.minDollarVol,
): Selection {
  const { afterUnused, removedUsed, notCommon, kept } = commonStock(members, assets);
  const status = new Map<string, string>();
  const log: Selection["log"] = [
    { step: "0 pool (S&P 500 + Nasdaq-100, 2026-08-31)", left: members.length, removed: [] },
    { step: "1 exclude the 11 used symbols (and their other share classes)", left: afterUnused.length, removed: removedUsed },
  ];

  // Share classes: same CIK (S&P table) -> keep the higher dollar volume, ties alphabetical.
  const byCik = new Map<string, Member[]>();
  for (const m of kept) if (m.cik) byCik.set(m.cik, [...(byCik.get(m.cik) ?? []), m]);
  const dupes = new Set<string>();
  for (const group of byCik.values()) {
    if (group.length < 2) continue;
    const best = [...group].sort((a, b) => (stats.get(b.ticker)?.dollarVol ?? 0) - (stats.get(a.ticker)?.dollarVol ?? 0) || (a.ticker < b.ticker ? -1 : 1))[0];
    for (const m of group) if (m !== best) { dupes.add(m.ticker); status.set(m.ticker, `share class of ${best.ticker}`); }
  }
  const common = kept.filter((m) => !dupes.has(m.ticker));
  log.push({ step: "2 common stock only (no ADR/ETF, one share class)", left: common.length, removed: [...notCommon, ...dupes].sort() });

  const step = (label: string, list: Member[], keep: (s: Stats) => boolean, reason: string): Member[] => {
    const out: Member[] = [], removed: string[] = [];
    for (const m of list) {
      const s = stats.get(m.ticker);
      if (s && keep(s)) out.push(m); else { removed.push(m.ticker); status.set(m.ticker, reason); }
    }
    log.push({ step: label, left: out.length, removed });
    return out;
  };
  const p = step("3 average price > $20", common, (s) => s.price > RULES.minPrice, "price");
  const dv = step(`4 average daily dollar volume >= $${dollarFloor / 1e6}M`, p, (s) => s.dollarVol >= dollarFloor, "dollar volume");
  const cov = step("5 entry-window bar coverage >= 99%", dv, (s) => s.coverage >= RULES.minCoverage && finite(s), "coverage");

  const mom = MOMENTUM.map((t) => stats.get(t)!);
  const lo = { vol: Math.min(...mom.map((s) => s.vol)) * RULES.rangeLo, beta: Math.min(...mom.map((s) => s.beta)) * RULES.rangeLo };
  const hi = { vol: Math.max(...mom.map((s) => s.vol)) * RULES.rangeHi, beta: Math.max(...mom.map((s) => s.beta)) * RULES.rangeHi };
  const eligible = step(
    "6 realized vol and beta inside the Momentum range (x0.75 .. x1.25)", cov,
    (s) => s.vol >= lo.vol && s.vol <= hi.vol && s.beta >= lo.beta && s.beta <= hi.beta, "outside Momentum range",
  );

  // z-scores across the eligible pool; Momentum centroid in the same scale.
  const mean = {} as Record<Feature, number>, sd = {} as Record<Feature, number>;
  for (const f of FEATURES) {
    const xs = eligible.map((m) => featureOf(stats.get(m.ticker)!, f));
    mean[f] = xs.reduce((a, x) => a + x, 0) / xs.length;
    sd[f] = Math.sqrt(xs.reduce((a, x) => a + (x - mean[f]) ** 2, 0) / xs.length) || 1;
  }
  const zOf = (s: Stats) => Object.fromEntries(FEATURES.map((f) => [f, (featureOf(s, f) - mean[f]) / sd[f]])) as Record<Feature, number>;
  const centroid = Object.fromEntries(FEATURES.map((f) => [f, mom.reduce((a, s) => a + zOf(s)[f], 0) / mom.length])) as Record<Feature, number>;

  const ranked: Candidate[] = eligible.map((m) => {
    const s = stats.get(m.ticker)!;
    const z = zOf(s);
    const distance = Math.sqrt(FEATURES.reduce((a, f) => a + (z[f] - centroid[f]) ** 2, 0));
    return { ...s, sector: m.sector, sectorSource: m.sectorSource, cik: m.cik, assetName: assets.get(m.ticker)!.name, distance, z };
  }).sort((a, b) => a.distance - b.distance || (a.symbol < b.symbol ? -1 : 1));

  const perSector = new Map<string, number>();
  const selected: Candidate[] = [], skippedForSector: string[] = [];
  for (const c of ranked) {
    if (selected.length >= RULES.take) break;
    const k = perSector.get(c.sector) ?? 0;
    if (k >= RULES.perSector) { skippedForSector.push(c.symbol); status.set(c.symbol, "sector cap"); continue; }
    perSector.set(c.sector, k + 1);
    selected.push(c);
  }
  for (const c of ranked) if (!status.has(c.symbol)) status.set(c.symbol, selected.includes(c) ? "selected" : "rank");
  log.push({ step: `select: rank by distance, <= ${RULES.perSector} per sector, top ${RULES.take}`, left: selected.length, removed: skippedForSector });

  return {
    dollarFloor, fallbackUsed: false, log, momentum: { stats: mom, lo, hi }, pool: { mean, sd }, ranked, selected, skippedForSector, status,
  };
}

/** The pre-set rule: if fewer than 25 pass at $1B, redo once at $500M and say so. */
export function selectWithFallback(members: readonly Member[], assets: ReadonlyMap<string, AssetInfo>, stats: ReadonlyMap<string, Stats>): Selection {
  const first = select(members, assets, stats, RULES.minDollarVol);
  if (first.selected.length >= RULES.take) return first;
  return { ...select(members, assets, stats, RULES.fallbackDollarVol), fallbackUsed: true };
}

// ---------------------------------------------------------------- flags (reported, never acted on)

export interface CorpAction { symbol: string; type: string; date: string; detail: string }

export function nearCutoffFlags(sel: Selection, stats: ReadonlyMap<string, Stats>): string[] {
  const out: string[] = [];
  const near = (x: number, cut: number) => Math.abs(x - cut) <= RULES.nearPct * cut;
  for (const c of sel.selected) {
    if (near(c.price, RULES.minPrice)) out.push(`${c.symbol}: price $${c.price.toFixed(2)} within 5% of $20`);
    if (near(c.dollarVol, sel.dollarFloor)) out.push(`${c.symbol}: dollar volume $${(c.dollarVol / 1e6).toFixed(0)}M within 5% of the floor`);
    if (c.coverage - RULES.minCoverage <= RULES.nearCoverage) out.push(`${c.symbol}: coverage ${(c.coverage * 100).toFixed(2)}% just above 99%`);
  }
  // Excluded by a threshold by less than 5%.
  for (const [sym, why] of [...sel.status.entries()].sort()) {
    const s = stats.get(sym);
    if (!s) continue;
    if (why === "price" && near(s.price, RULES.minPrice)) out.push(`${sym}: excluded on price ($${s.price.toFixed(2)}), within 5% of $20`);
    if (why === "dollar volume" && near(s.dollarVol, sel.dollarFloor)) out.push(`${sym}: excluded on dollar volume ($${(s.dollarVol / 1e6).toFixed(0)}M), within 5% of the floor`);
    if (why === "coverage" && RULES.minCoverage - s.coverage <= RULES.nearCoverage) out.push(`${sym}: excluded on coverage (${(s.coverage * 100).toFixed(2)}%), just below 99%`);
  }
  // Rank boundary: around the 25th pick's distance.
  const last = sel.selected[sel.selected.length - 1];
  if (last) {
    for (const c of sel.ranked) {
      const inSel = sel.selected.includes(c);
      if (inSel && c.distance >= last.distance * (1 - RULES.nearPct) && c !== last) out.push(`${c.symbol}: selected, distance ${c.distance.toFixed(3)} within 5% of the last pick (${last.distance.toFixed(3)})`);
      if (!inSel && sel.status.get(c.symbol) === "rank" && c.distance <= last.distance * (1 + RULES.nearPct)) out.push(`${c.symbol}: not selected, distance ${c.distance.toFixed(3)} within 5% of the last pick (${last.distance.toFixed(3)})`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- render (deterministic)

const f2 = (x: number) => x.toFixed(2), f3 = (x: number) => x.toFixed(3), f4 = (x: number) => x.toFixed(4);
const bps = (x: number) => (x * 1e4).toFixed(2);
const musd = (x: number) => (x / 1e6).toFixed(0);

export function renderJson(snap: Snapshot, sel: Selection, corp: CorpAction[], flags: string[]): string {
  const row = (s: Stats) => ({
    price: f2(s.price), dollarVolM: musd(s.dollarVol), coverage: f4(s.coverage), volBps: bps(s.vol),
    beta: f3(s.beta), corr: f3(s.corr), stretch: f4(s.stretch), days: s.days,
  });
  return JSON.stringify({
    stage: "4a out-of-universe",
    window: WINDOW,
    membership: snap.sources,
    rules: { ...RULES, dollarFloorUsed: sel.dollarFloor, fallbackUsed: sel.fallbackUsed },
    momentum: Object.fromEntries(sel.momentum.stats.map((s) => [s.symbol, row(s)])),
    benchmark: BENCHMARK,
    symbols: [...sel.selected.map((c) => c.symbol), BENCHMARK],
    selected: sel.selected.map((c, i) => ({ rank: i + 1, symbol: c.symbol, sector: c.sector, sectorSource: c.sectorSource, distance: f3(c.distance), ...row(c) })),
    filterLog: sel.log,
    corporateActions: corp,
    flags,
  }, null, 2) + "\n";
}

export function renderMd(snap: Snapshot, sel: Selection, corp: CorpAction[], flags: string[]): string {
  const L: string[] = [];
  const head = "| Ticker | Sector | Price $ | $ vol/day (M) | Coverage | Vol (bps/min) | Beta | Corr | Stretch ≥1.5 |";
  const sep = "|---|---|---|---|---|---|---|---|---|";
  const cells = (s: Stats) => `${f2(s.price)} | ${musd(s.dollarVol)} | ${(s.coverage * 100).toFixed(2)}% | ${bps(s.vol)} | ${f2(s.beta)} | ${f2(s.corr)} | ${(s.stretch * 100).toFixed(1)}% |`;
  L.push("# Stage 4a universe: out-of-universe stocks similar to Momentum", "");
  L.push(`Selected with \`selectUniverse.ts\` on ${WINDOW.start.slice(0, 10)} → ${WINDOW.end.slice(0, 10)} 1-minute bars only. No test-period data or strategy results were used.`, "");
  L.push("| | |", "|---|---|");
  L.push(`| **Pool** | S&P 500 (Wikipedia rev ${snap.sources.sp500.revid}, ${snap.sources.sp500.timestamp.slice(0, 10)}) + Nasdaq-100 (rev ${snap.sources.ndx100.revid}, ${snap.sources.ndx100.timestamp.slice(0, 10)}) |`);
  L.push(`| **Rank** | Distance to the Momentum centroid (${MOMENTUM.join(", ")}) on z-scored realized vol, log $ volume, beta, correlation to SPY, VWAP-stretch frequency |`);
  L.push(`| **Select** | ≤ ${RULES.perSector} per GICS sector, top ${RULES.take}; dollar-volume floor $${sel.dollarFloor / 1e6}M${sel.fallbackUsed ? " (**fallback used**)" : " (no fallback)"} |`);
  L.push(`| **Benchmark** | ${BENCHMARK}, not traded |`);
  L.push(`| **Symbols** | \`${[...sel.selected.map((c) => c.symbol), BENCHMARK].join(",")}\` |`, "");

  L.push("## Momentum reference", "", head, sep);
  for (const s of sel.momentum.stats) L.push(`| ${s.symbol} | | ${cells(s)}`);
  L.push("", `Range gate: vol ${bps(sel.momentum.lo.vol)}–${bps(sel.momentum.hi.vol)} bps/min, beta ${f2(sel.momentum.lo.beta)}–${f2(sel.momentum.hi.beta)}.`, "");

  L.push("## Selected", "", "| Rank | Distance " + head, "|---|---" + sep.slice(0));
  sel.selected.forEach((c, i) => L.push(`| ${i + 1} | ${f3(c.distance)} | ${c.symbol} | ${c.sector}${c.sectorSource === "icb" ? "¹" : ""} | ${cells(c)}`));
  const sectors = new Map<string, number>();
  for (const c of sel.selected) sectors.set(c.sector, (sectors.get(c.sector) ?? 0) + 1);
  L.push("", `By sector: ${[...sectors.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, n]) => `${k} ${n}`).join(", ")}.`);
  if (sel.selected.some((c) => c.sectorSource === "icb")) L.push("", "¹ Nasdaq-100 only: ICB industry mapped to the nearest GICS sector.");
  L.push("");

  const next = sel.ranked.filter((c) => !sel.selected.includes(c)).slice(0, 10);
  if (next.length) {
    L.push("## Next 10 by distance (not selected)", "", "| Distance | Ticker | Sector | Reason |", "|---|---|---|---|");
    for (const c of next) L.push(`| ${f3(c.distance)} | ${c.symbol} | ${c.sector} | ${sel.status.get(c.symbol)} |`);
    L.push("");
  }

  L.push("## Filter log", "", "| Step | Left | Removed |", "|---|---|---|");
  for (const s of sel.log) L.push(`| ${s.step} | ${s.left} | ${s.removed.length > 25 ? `${s.removed.length} symbols` : s.removed.join(", ") || "–"} |`);
  L.push("");

  L.push("## Flags (reported only)", "");
  L.push("**Corporate actions in the window** (selected stocks):", "");
  if (corp.length) for (const a of corp) L.push(`- ${a.symbol}: ${a.type} ${a.date} (${a.detail})`); else L.push("- None.");
  L.push("", "**Near a cutoff:**", "");
  if (flags.length) for (const f of flags) L.push(`- ${f}`); else L.push("- None.");
  L.push("");
  return L.join("\n");
}

// ---------------------------------------------------------------- I/O

const DATA_URL = "https://data.alpaca.markets";
const OUT_DIR = path.dirname(SNAPSHOT_PATH);
const CONCURRENCY = 6;

/** alpacaGet retries 429/5xx; this also retries dropped connections (ECONNRESET, fetch failed). */
async function getRetry<T>(limiter: RateLimiter, base: string, p: string): Promise<T> {
  const creds = { key: env.alpacaDataKey, secret: env.alpacaDataSecret };
  for (let attempt = 1; ; attempt++) {
    try {
      return await limiter.schedule(() => alpacaGet<T>(base, p, creds));
    } catch (e) {
      const network = e instanceof TypeError || /ECONNRESET|ETIMEDOUT|fetch failed|socket/i.test(String((e as Error)?.message) + String((e as { cause?: unknown })?.cause));
      if (!network || attempt >= 6) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

async function fetchBars(limiter: RateLimiter, symbol: string): Promise<RawBar[]> {
  const out: RawBar[] = [];
  let token: string | undefined;
  do {
    const q = new URLSearchParams({
      start: WINDOW.start, end: WINDOW.end, timeframe: "1Min", limit: "10000", adjustment: "raw", feed: "sip",
      ...(token ? { page_token: token } : {}),
    });
    const page = await getRetry<{ bars: RawBar[] | null; next_page_token?: string | null }>(limiter, DATA_URL, `/v2/stocks/${encodeURIComponent(symbol)}/bars?${q}`);
    for (const b of page.bars ?? []) out.push(b);
    token = page.next_page_token ?? undefined;
  } while (token);
  return out.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

async function fetchAsset(limiter: RateLimiter, symbol: string): Promise<AssetInfo> {
  try {
    const a = await getRetry<{ class: string; tradable: boolean; name: string }>(limiter, env.alpacaPaperBaseUrl, `/v2/assets/${encodeURIComponent(symbol)}`);
    return { symbol, found: true, cls: a.class, tradable: a.tradable, name: a.name };
  } catch (e) {
    // Only a 404 means "no such asset"; anything else must fail the run, not silently drop a symbol.
    if (!/\(404\)/.test(String((e as Error).message))) throw e;
    return { symbol, found: false, cls: "", tradable: false, name: "" };
  }
}

async function fetchCorpActions(limiter: RateLimiter, symbols: string[]): Promise<CorpAction[]> {
  const q = new URLSearchParams({
    symbols: symbols.join(","), start: WINDOW.start.slice(0, 10), end: WINDOW.end.slice(0, 10), limit: "1000",
    types: "forward_split,reverse_split,unit_split,stock_dividend,spin_off,cash_merger,stock_merger,stock_and_cash_merger,name_change",
  });
  const j = await getRetry<{ corporate_actions: Record<string, Record<string, unknown>[]> }>(limiter, DATA_URL, `/v1/corporate-actions?${q}`);
  const out: CorpAction[] = [];
  const want = new Set(symbols);
  for (const [type, list] of Object.entries(j.corporate_actions ?? {}).sort()) {
    for (const a of list) {
      const sym = String(a.symbol ?? a.acquirer_symbol ?? a.source_symbol ?? a.old_symbol ?? "");
      if (!want.has(sym)) continue;
      const date = String(a.ex_date ?? a.effective_date ?? a.process_date ?? "");
      const detail = a.new_rate !== undefined ? `${a.old_rate}→${a.new_rate}` : String(a.acquiree_symbol ?? a.new_symbol ?? a.target_symbol ?? "");
      out.push({ symbol: sym, type: type.replace(/s$/, ""), date, detail });
    }
  }
  return out.sort((a, b) => (a.symbol + a.date + a.type < b.symbol + b.date + b.type ? -1 : 1));
}

async function pool<T, R>(items: readonly T[], k: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: k }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/** One full run from scratch: fetch, compute, select, render. */
export async function runOnce(tag: string): Promise<{ json: string; md: string }> {
  const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
  const limiter = new RateLimiter(env.alpacaDataRequestsPerMinute || 190);
  const members = snap.members;

  const assetList = await pool(members.filter((m) => !USED.includes(m.ticker)).map((m) => m.ticker), CONCURRENCY, (s) => fetchAsset(limiter, s));
  const assets = new Map(assetList.map((a) => [a.symbol, a]));
  const { kept } = commonStock(members, assets);

  const spy = await fetchBars(limiter, BENCHMARK);
  const clock = buildClock(spy);
  const toFetch = [...new Set([...kept.map((m) => m.ticker), ...MOMENTUM])].sort();
  const stats = new Map<string, Stats>();
  let done = 0;
  await pool(toFetch, CONCURRENCY, async (sym) => {
    stats.set(sym, computeStats(sym, await fetchBars(limiter, sym), clock));
    if (++done % 50 === 0) console.log(`[${tag}] bars ${done}/${toFetch.length}`);
  });

  const sel = selectWithFallback(members, assets, stats);
  const corp = await fetchCorpActions(limiter, sel.selected.map((c) => c.symbol));
  const flags = nearCutoffFlags(sel, stats);
  return { json: renderJson(snap, sel, corp, flags), md: renderMd(snap, sel, corp, flags) };
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const a = await runOnce("run 1");
  const h1 = sha(a.json + a.md);
  console.log(`run 1 sha256 ${h1}`);
  if (argv.includes("--check")) {
    const b = await runOnce("run 2");
    const h2 = sha(b.json + b.md);
    console.log(`run 2 sha256 ${h2}`);
    if (h1 !== h2) { console.error("CHECK FAILED: the two runs differ"); process.exit(2); }
    console.log("CHECK OK: byte-identical");
  }
  if (argv.includes("--write")) {
    writeFileSync(path.join(OUT_DIR, "universe.json"), a.json);
    writeFileSync(path.join(OUT_DIR, "universe.md"), a.md);
    console.log(`wrote ${path.join(OUT_DIR, "universe.{json,md}")}`);
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
