/**
 * core/backtest/equityCurveStorage.ts
 *
 * The shape a backtest's equity curve is stored in. The engine samples full
 * portfolio snapshots (positions and per-strategy breakdowns included), but
 * every reader of a stored curve draws a line from ts and equity, so storing
 * the whole snapshot per point multiplied each saved backtest's size for
 * nothing. Cash and initial capital stay for the baseline and the summary.
 */

import type { PortfolioSnapshot } from "../../types/portfolio";

export interface StoredEquityPoint {
  ts: number;
  isoTs: string;
  equity: number;
  cash: number;
  initialCapital: number;
}

export function slimEquityCurve(curve: PortfolioSnapshot[] | undefined): StoredEquityPoint[] {
  return (curve ?? []).map((p) => ({
    ts: p.ts,
    isoTs: p.isoTs ?? new Date(p.ts).toISOString(),
    equity: p.equity,
    cash: p.cash,
    initialCapital: p.initialCapital,
  }));
}
