/**
 * runtime/team3Metrics/trades.ts
 *
 * Shared inputs for the Stage 2 mechanism metrics: Team 3 signals paired into
 * round trips, and the bars each symbol saw. Built by runtime/team3Backtest.ts;
 * each goal's metric file (r1.ts, r2.ts, ...) reads them. Owner: team lead.
 */

import type { StrategySignal } from "../../types/strategy";
import type { DailyPnl } from "../../strategies/team3Reversal/contract/daily";

export interface MetricBar { ts: number; open: number; high: number; low: number; close: number; volume: number }

export interface RoundTrip {
  symbol: string;
  side: "buy" | "sell";
  /** Signal times (bar ts) of the entry and of the exit decision. */
  entryTs: number;
  exitTs: number;
  qty: number;
  /** What the sizing step asked for, before caps (entry meta qtyWanted). */
  qtyWanted: number | null;
  /** Entry bar close (signal-level; the fill is the next bar's open). */
  entryClose: number;
  entryZ: number | null;
  edgeBps: number | null;
  reason: string;
  barsHeld: number;
  /** Exit close vs the real entry fill, before the exit's own costs. */
  pnlBpsGross: number;
}

/** What every goal metric receives. */
export interface MetricInput {
  signals: readonly StrategySignal[];
  roundTrips: readonly RoundTrip[];
  /** Every bar each symbol showed the strategy, in time order (extended hours included). */
  barsBySymbol: ReadonlyMap<string, readonly MetricBar[]>;
  daily: readonly DailyPnl[];
  config: Record<string, unknown>;
}

const num = (x: unknown): number | null => (x === null || x === undefined || !Number.isFinite(Number(x)) ? null : Number(x));

/** Pairs each symbol's enter signal with its next exit signal. Unclosed entries are dropped. */
export function pairRoundTrips(signals: readonly StrategySignal[]): RoundTrip[] {
  const open = new Map<string, StrategySignal>();
  const out: RoundTrip[] = [];
  for (const s of signals) {
    const kind = s.meta?.kind;
    if (kind === "enter") open.set(s.symbol, s);
    else if (kind === "exit") {
      const e = open.get(s.symbol);
      if (!e) continue;
      open.delete(s.symbol);
      out.push({
        symbol: s.symbol,
        side: e.direction === "short" ? "sell" : "buy",
        entryTs: e.ts, exitTs: s.ts,
        qty: Math.abs(e.qty),
        qtyWanted: num(e.meta?.qtyWanted),
        entryClose: Number(e.meta?.close),
        entryZ: num(e.meta?.vwapZ),
        edgeBps: num(e.meta?.edgeBps),
        reason: String(s.meta?.reason),
        barsHeld: Number(s.meta?.barsHeld),
        pnlBpsGross: Number(s.meta?.pnlBpsGross),
      });
    }
  }
  return out;
}
