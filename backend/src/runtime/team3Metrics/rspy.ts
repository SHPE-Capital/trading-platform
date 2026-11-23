/**
 * runtime/team3Metrics/rspy.ts
 *
 * relativeToSpy mechanism: reversion share, and the beta of per-trade P&L to SPY
 * over the holding window. Owner: the rspy Stage 2 session (branch team3/rspy).
 *
 *   spyBps  = (SPY close at exitTs / SPY close at entryTs - 1) x 1e4   (signal bars, same as pnlBpsGross)
 *   beta    = OLS slope of pnlBpsGross on spyBps over trades with both SPY bars (primary, as specced)
 *   betaSideAdj = slope on spyBps x (+1 long, -1 short): P&L per bp of SPY moving the trade's way
 * Computed whatever the switches are (it reads results only), so baseline rows have a value too.
 */

import type { MetricInput, MetricBar } from "./trades";

const closeAt = (bars: readonly MetricBar[], ts: number): number | null => {
  let lo = 0, hi = bars.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].ts === ts) return bars[mid].close > 0 ? bars[mid].close : null;
    if (bars[mid].ts < ts) lo = mid + 1; else hi = mid - 1;
  }
  return null;
};

export function olsSlope(x: readonly number[], y: readonly number[]): number | null {
  const n = x.length;
  if (n < 2) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  return sxx > 0 ? sxy / sxx : null;
}

const round = (v: number | null, d = 4) => (v === null ? null : Number(v.toFixed(d)));

export function rspyMetrics(input: MetricInput): Record<string, unknown> {
  const trips = input.roundTrips;
  if (!trips.length) return {};
  const benchmark = String(input.config.benchmarkSymbol ?? "SPY");
  const spy = input.barsBySymbol.get(benchmark) ?? [];
  const x: number[] = [], xs: number[] = [], y: number[] = [];
  for (const t of trips) {
    const a = closeAt(spy, t.entryTs), b = closeAt(spy, t.exitTs);
    if (a === null || b === null || !Number.isFinite(t.pnlBpsGross)) continue;
    const bps = (b / a - 1) * 1e4;
    x.push(bps); xs.push(t.side === "buy" ? bps : -bps); y.push(t.pnlBpsGross);
  }
  const targets = trips.filter((t) => t.reason === "target").length;
  return {
    trades: trips.length,
    reversionShare: trips.length ? round(targets / trips.length) : null,
    betaTrades: x.length,
    beta: round(olsSlope(x, y)),
    betaSideAdj: round(olsSlope(xs, y)),
  };
}
