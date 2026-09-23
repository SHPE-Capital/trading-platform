/**
 * core/backtest/barCache.ts
 *
 * Storage-agnostic contract for the shared bar cache (Part 03), plus the UTC
 * day arithmetic BacktestLoader uses to decide which days to read locally and
 * which to fetch from Alpaca.
 *
 * Coverage is tracked per (symbol, timeframe, UTC day). A day is "complete"
 * once every bar Alpaca had for it has been written, which is what lets the
 * loader tell a cache miss apart from a genuinely empty day (weekend, holiday,
 * halt, pre-listing) without asking Alpaca again.
 */

import type { Bar } from "../../types/market";

export const DAY_MS = 86_400_000;

export interface BarCache {
  /** UTC days (YYYY-MM-DD) in [fromDay, toDay] already known complete. */
  getCompleteDays(symbol: string, timeframe: string, fromDay: string, toDay: string): Promise<Set<string>>;
  /** Bars with ts in [startMs, endMs), ascending by ts. */
  readBars(symbol: string, timeframe: string, startMs: number, endMs: number): Promise<Bar[]>;
  /** Upserts bars; a re-fetched bar replaces the cached one (Alpaca revises recent bars). */
  writeBars(symbol: string, timeframe: string, bars: Bar[]): Promise<void>;
  /** Records days as complete. barCount 0 is meaningful: a known-empty day. */
  markComplete(symbol: string, timeframe: string, days: { day: string; barCount: number }[]): Promise<void>;
}

/** "2025-09-22" for any ms inside that UTC day. */
export function utcDay(ms: number): string {
  return new Date(Math.floor(ms / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

/** Epoch ms of 00:00:00Z on the given YYYY-MM-DD. */
export function utcDayStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/**
 * Every UTC day touched by [startMs, endMs]. An end that falls exactly on
 * midnight contributes nothing but that instant, so its day is left out —
 * otherwise a range ending "2025-09-22T00:00:00Z" would fetch all of Sept 22.
 */
export function utcDaysInRange(startMs: number, endMs: number): string[] {
  if (endMs < startMs) return [];
  let lastMs = endMs;
  if (endMs > startMs && endMs % DAY_MS === 0) lastMs = endMs - 1;
  const days: string[] = [];
  for (let d = Math.floor(startMs / DAY_MS) * DAY_MS; d <= lastMs; d += DAY_MS) {
    days.push(utcDay(d));
  }
  return days;
}

export interface DayRun {
  cached: boolean;
  days: string[];
}

/** Splits an ordered day list into maximal runs of cached / uncached days. */
export function splitIntoRuns(days: string[], complete: Set<string>): DayRun[] {
  const runs: DayRun[] = [];
  for (const day of days) {
    const cached = complete.has(day);
    const last = runs[runs.length - 1];
    if (last && last.cached === cached) last.days.push(day);
    else runs.push({ cached, days: [day] });
  }
  return runs;
}
