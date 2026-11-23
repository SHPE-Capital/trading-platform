/**
 * runtime/team3Metrics/r1.ts
 *
 * R1 liquidity: adverse move over the first bars after entry.
 * Owner: the r1 Stage 2 session (branch team3/r1). Only that session edits this file.
 *
 * reversionShare: target exits / round trips.
 * adverse excursion (bps, >= 0): over the first ADVERSE_BARS bars after the entry signal bar,
 * the highest high for shorts (lowest low for longs) vs entryClose, floored at 0.
 */

import type { MetricBar, MetricInput, RoundTrip } from "./trades";

export const ADVERSE_BARS = 5;

export function adverseBps(rt: RoundTrip, bars: readonly MetricBar[], n = ADVERSE_BARS): number | null {
  const after = bars.filter((b) => b.ts > rt.entryTs).slice(0, n);
  if (after.length === 0 || !(rt.entryClose > 0)) return null;
  const worst = rt.side === "sell"
    ? (Math.max(...after.map((b) => b.high)) - rt.entryClose) / rt.entryClose
    : (rt.entryClose - Math.min(...after.map((b) => b.low))) / rt.entryClose;
  return Math.max(0, worst * 10_000);
}

const round = (x: number) => Math.round(x * 100) / 100;

export function r1Metrics(input: MetricInput): Record<string, unknown> {
  const rts = input.roundTrips;
  if (rts.length === 0) return {};   // nothing to measure (also keeps the shared stage2Tooling stub check meaningful)
  const targets = rts.filter((r) => r.reason === "target").length;
  const adv = rts
    .map((r) => adverseBps(r, input.barsBySymbol.get(r.symbol) ?? []))
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b);
  const mid = adv.length / 2;
  const median = adv.length === 0 ? null : adv.length % 2 ? adv[Math.floor(mid)] : (adv[mid - 1] + adv[mid]) / 2;
  return {
    trades: rts.length,
    reversionShare: rts.length ? round((targets / rts.length) * 100) / 100 : null,
    adverse5MeanBps: adv.length ? round(adv.reduce((s, x) => s + x, 0) / adv.length) : null,
    adverse5MedianBps: median === null ? null : round(median),
    adverseMeasured: adv.length,
  };
}
