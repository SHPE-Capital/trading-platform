/**
 * runtime/team3Metrics/r5.ts
 *
 * R5 portfolio mechanism checks (definitions pre-registered in docs/team3/results/ledger-r5.md):
 *   capBindShare        entries with qty < qtyWanted / entries with a qtyWanted
 *   symbolPnlStdUsd     std (population) of per-symbol summed trade P&L, $
 *   worstClusterLossUsd worst summed P&L of a cluster (>= 3 same-side entries at one signal minute)
 *   clusterDays         ET days holding at least one such cluster
 *   clusterDayMaxDdUsd  max drawdown of the equity path built from cluster days' daily P&L, in date order
 *   clusterDayWorstUsd  worst single cluster-day P&L
 * Trade $ P&L = qty x entryClose x pnlBpsGross / 1e4 (gross, signal-level: before the exit's costs).
 * Owner: the r5 Stage 2 session (branch team3/r5). Only that session edits this file.
 */

import type { MetricInput, RoundTrip } from "./trades";
import { etDate } from "../../strategies/team3Reversal/contract/daily";

export const CLUSTER_MIN_ENTRIES = 3;

const usd = (t: RoundTrip): number => (t.qty * t.entryClose * t.pnlBpsGross) / 10_000;
const round = (x: number, d = 2): number => Math.round(x * 10 ** d) / 10 ** d;

export function r5Metrics(input: MetricInput): Record<string, unknown> {
  const trips = input.roundTrips.filter((t) => Number.isFinite(usd(t)));
  if (trips.length === 0) return {};
  const withWanted = trips.filter((t) => t.qtyWanted !== null);
  const capBound = withWanted.filter((t) => t.qty < (t.qtyWanted as number)).length;

  const bySymbol = new Map<string, number>();
  for (const t of trips) bySymbol.set(t.symbol, (bySymbol.get(t.symbol) ?? 0) + usd(t));
  const vals = [...bySymbol.values()];
  const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length));

  const groups = new Map<string, RoundTrip[]>();
  for (const t of trips) {
    const k = `${t.entryTs}|${t.side}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const clusters = [...groups.values()].filter((g) => g.length >= CLUSTER_MIN_ENTRIES);
  const clusterLosses = clusters.map((g) => g.reduce((a, t) => a + usd(t), 0));
  const days = new Set(clusters.map((g) => etDate(g[0].entryTs)));

  let eq = 0, peak = 0, dd = 0, worstDay = 0;
  for (const d of [...input.daily].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!days.has(d.date)) continue;
    eq += d.pnl; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); worstDay = Math.min(worstDay, d.pnl);
  }

  return {
    entries: trips.length,
    capBindShare: withWanted.length ? round(capBound / withWanted.length, 4) : null,
    symbolPnlStdUsd: round(std),
    clusters: clusters.length,
    worstClusterLossUsd: clusterLosses.length ? round(Math.min(...clusterLosses)) : null,
    clusterDays: days.size,
    clusterDayMaxDdUsd: round(dd),
    clusterDayWorstUsd: round(worstDay),
  };
}
