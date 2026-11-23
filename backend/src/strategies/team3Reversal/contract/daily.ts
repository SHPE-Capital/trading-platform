/**
 * strategies/team3Reversal/contract/daily.ts
 *
 * Daily P&L from a backtest equity curve, by America/New_York trading date.
 * Used by runtime/team3Backtest.ts (ablation columns) and runtime/team3Bootstrap.ts
 * (paired day-bootstrap), so both count days the same way.
 *
 * Why points after the window are folded into the last in-window day:
 * the engine stamps its final mark-to-market snapshot with the wall clock,
 * not the simulated clock (UPSTREAM.md #10). Bucketed as-is, that point became a
 * phantom extra "day" dated the day the run happened (33 IS days instead of 32).
 * Folding it into the last real day keeps sum(daily) == net P&L.
 */

import type { EquityPoint } from "../../../core/backtest/performanceAnalytics";

export interface DailyPnl {
  /** ET trading date, YYYY-MM-DD. */
  date: string;
  /** Last equity of this day minus last equity of the previous day (first day: minus starting capital). */
  pnl: number;
}

const ET_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

/** ET calendar date (YYYY-MM-DD) of an epoch-ms timestamp. */
export function etDate(ts: number): string {
  return ET_DAY.format(new Date(ts));
}

/**
 * Daily P&L by ET date. Points before window.startDate are ignored; points after
 * window.endDate count toward the last day inside the window.
 */
export function dailyPnl(
  curve: readonly EquityPoint[], initialCapital: number, window: { startDate: string; endDate: string },
): DailyPnl[] {
  const startMs = Date.parse(window.startDate);
  const endMs = Date.parse(window.endDate);
  const lastByDay = new Map<string, number>();
  let lastDay: string | null = null;
  for (const p of curve) {
    // Saved curves come back from Postgres JSON; accept epoch ms as a number, numeric string or ISO string.
    const raw = p.ts as unknown;
    const ts = typeof raw === "number" ? raw : Number.isFinite(Number(raw)) ? Number(raw) : Date.parse(String(raw));
    if (!Number.isFinite(ts) || ts < startMs) continue;
    if (ts > endMs) {
      if (lastDay !== null) lastByDay.set(lastDay, p.equity);
      continue;
    }
    lastDay = etDate(ts);
    lastByDay.set(lastDay, p.equity);
  }
  const out: DailyPnl[] = [];
  let prev = initialCapital;
  for (const [date, equity] of lastByDay) {
    out.push({ date, pnl: equity - prev });
    prev = equity;
  }
  return out;
}
