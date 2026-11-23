/**
 * strategies/team3Reversal/contract/bootstrap.ts
 *
 * Paired day-bootstrap (R6-T1): is run B better than run A on the same days?
 *
 *   1. Pair daily net P&L by ET date (inner join; unmatched dates are reported, not used).
 *   2. d[i] = pnlB[i] - pnlA[i].
 *   3. Resample the n paired days with replacement, `draws` times, from a fixed seed.
 *   4. Report the share of draws whose mean d > 0 (B beats A) and a 95% percentile
 *      CI on the mean daily difference.
 *   5. Repeat on the first and second halves of the paired days (by date), so a
 *      row can be checked for agreement across sub-periods (keep rule, MASTER.md).
 *
 * Plain iid day resampling (Efron & Tibshirani 1993). Pure: no I/O; the CLI is
 * runtime/team3Bootstrap.ts.
 */

import { seededRandom } from "../../../bench/random";
import type { DailyPnl } from "./daily";

export const BOOTSTRAP_DEFAULTS = { draws: 10_000, seed: 20261123 };

export interface BootstrapStats {
  /** Paired days used. */
  n: number;
  /** First and last paired date. */
  from: string | null;
  to: string | null;
  /** Observed mean of pnlB - pnlA, $/day. */
  meanDiff: number;
  /** Share of resamples with mean(B - A) > 0. */
  shareBBeatsA: number;
  /** 95% percentile interval on the mean daily difference, $/day. */
  ci95: [number, number];
}

export interface PairedBootstrapResult {
  draws: number;
  seed: number;
  all: BootstrapStats;
  firstHalf: BootstrapStats;
  secondHalf: BootstrapStats;
  /** Both halves' observed mean differences have the same sign (zero counts as no agreement). */
  halvesAgree: boolean;
  /** Dates present in only one run (excluded). */
  onlyA: string[];
  onlyB: string[];
}

export interface PairedDays { dates: string[]; diffs: number[]; onlyA: string[]; onlyB: string[] }

/** Inner join of two daily P&L series by date, sorted by date: diffs = B - A. */
export function pairDays(a: readonly DailyPnl[], b: readonly DailyPnl[]): PairedDays {
  const aBy = new Map(a.map((x) => [x.date, x.pnl]));
  const bBy = new Map(b.map((x) => [x.date, x.pnl]));
  const dates = [...aBy.keys()].filter((d) => bBy.has(d)).sort();
  return {
    dates,
    diffs: dates.map((d) => (bBy.get(d) as number) - (aBy.get(d) as number)),
    onlyA: [...aBy.keys()].filter((d) => !bBy.has(d)).sort(),
    onlyB: [...bBy.keys()].filter((d) => !aBy.has(d)).sort(),
  };
}

/** Day-resampling bootstrap of the mean of `diffs`. */
export function bootstrapMean(
  dates: readonly string[], diffs: readonly number[], opts: { draws: number; seed: number },
): BootstrapStats {
  const n = diffs.length;
  const from = n ? dates[0] : null;
  const to = n ? dates[n - 1] : null;
  if (n === 0) return { n, from, to, meanDiff: 0, shareBBeatsA: 0, ci95: [0, 0] };
  const rand = seededRandom(opts.seed);
  const means = new Float64Array(opts.draws);
  let wins = 0;
  for (let k = 0; k < opts.draws; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += diffs[Math.floor(rand() * n)];
    const m = s / n;
    means[k] = m;
    if (m > 0) wins += 1;
  }
  means.sort();
  const q = (p: number) => means[Math.min(opts.draws - 1, Math.floor(p * opts.draws))];
  const round = (x: number) => +x.toFixed(2);
  return {
    n, from, to,
    meanDiff: round(diffs.reduce((x, y) => x + y, 0) / n),
    shareBBeatsA: +(wins / opts.draws).toFixed(4),
    ci95: [round(q(0.025)), round(q(0.975))],
  };
}

/**
 * Paired day-bootstrap of B vs A, overall and per half. With an odd number of
 * paired days the extra day goes to the second half. Each part uses its own
 * seed (seed, seed+1, seed+2), so the result is reproducible part by part.
 */
export function pairedDayBootstrap(
  a: readonly DailyPnl[], b: readonly DailyPnl[], opts: Partial<{ draws: number; seed: number }> = {},
): PairedBootstrapResult {
  const draws = opts.draws ?? BOOTSTRAP_DEFAULTS.draws;
  const seed = opts.seed ?? BOOTSTRAP_DEFAULTS.seed;
  const p = pairDays(a, b);
  const mid = Math.floor(p.diffs.length / 2);
  const all = bootstrapMean(p.dates, p.diffs, { draws, seed });
  const firstHalf = bootstrapMean(p.dates.slice(0, mid), p.diffs.slice(0, mid), { draws, seed: seed + 1 });
  const secondHalf = bootstrapMean(p.dates.slice(mid), p.diffs.slice(mid), { draws, seed: seed + 2 });
  const sign = (x: number) => Math.sign(x);
  return {
    draws, seed, all, firstHalf, secondHalf,
    halvesAgree: sign(firstHalf.meanDiff) !== 0 && sign(firstHalf.meanDiff) === sign(secondHalf.meanDiff),
    onlyA: p.onlyA, onlyB: p.onlyB,
  };
}
