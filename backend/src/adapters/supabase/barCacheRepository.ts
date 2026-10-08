/**
 * adapters/supabase/barCacheRepository.ts
 *
 * Supabase-backed BarCache over the bars / bar_coverage tables (0002). Reads go
 * through the get_bars RPC (0011), which returns a whole range as one JSON
 * array — a plain select would be capped at PostgREST's 1000-row limit and turn
 * a year of minute bars into hundreds of round trips.
 */

import { getSupabaseClient } from "./client";
import type { BarCache } from "../../core/backtest/barCache";
import type { Bar } from "../../types/market";

const WRITE_CHUNK = 5_000;
const COVERAGE_PAGE = 1_000;

type BarTuple = [number, number, number, number, number, number, number | null, number | null];

export class SupabaseBarCache implements BarCache {
  async getCompleteDays(symbol: string, timeframe: string, fromDay: string, toDay: string): Promise<Set<string>> {
    const supabase = getSupabaseClient();
    const days = new Set<string>();
    for (let offset = 0; ; offset += COVERAGE_PAGE) {
      const { data, error } = await supabase
        .from("bar_coverage")
        .select("day")
        .eq("symbol", symbol)
        .eq("timeframe", timeframe)
        .eq("complete", true)
        .gte("day", fromDay)
        .lte("day", toDay)
        .order("day", { ascending: true })
        .range(offset, offset + COVERAGE_PAGE - 1);
      if (error) throw new Error(`bar_coverage read failed: ${error.message}`);
      for (const row of data ?? []) days.add(row.day as string);
      if (!data || data.length < COVERAGE_PAGE) return days;
    }
  }

  async readBars(symbol: string, timeframe: string, startMs: number, endMs: number): Promise<Bar[]> {
    const { data, error } = await getSupabaseClient().rpc("get_bars", {
      p_symbol: symbol,
      p_timeframe: timeframe,
      p_start: new Date(startMs).toISOString(),
      p_end: new Date(endMs).toISOString(),
    });
    if (error) throw new Error(`get_bars failed: ${error.message}`);
    return ((data ?? []) as BarTuple[]).map(([ts, open, high, low, close, volume, tradeCount, vwap]) => ({
      symbol,
      ts,
      isoTs: new Date(ts).toISOString(),
      open,
      high,
      low,
      close,
      volume,
      tradeCount: tradeCount ?? undefined,
      vwap: vwap ?? undefined,
      timeframe,
    }));
  }

  async writeBars(symbol: string, timeframe: string, bars: Bar[]): Promise<void> {
    const supabase = getSupabaseClient();
    const fetchedAt = new Date().toISOString();
    for (let i = 0; i < bars.length; i += WRITE_CHUNK) {
      const rows = bars.slice(i, i + WRITE_CHUNK).map((b) => ({
        symbol,
        timeframe,
        ts: new Date(b.ts).toISOString(),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
        trade_count: b.tradeCount ?? null,
        vwap: b.vwap ?? null,
        fetched_at: fetchedAt,
      }));
      const { error } = await supabase.from("bars").upsert(rows, { onConflict: "symbol,timeframe,ts" });
      if (error) throw new Error(`bars upsert failed: ${error.message}`);
    }
  }

  async markComplete(symbol: string, timeframe: string, days: { day: string; barCount: number }[]): Promise<void> {
    const supabase = getSupabaseClient();
    const fetchedAt = new Date().toISOString();
    for (let i = 0; i < days.length; i += COVERAGE_PAGE) {
      const rows = days.slice(i, i + COVERAGE_PAGE).map((d) => ({
        symbol,
        timeframe,
        day: d.day,
        bar_count: d.barCount,
        complete: true,
        fetched_at: fetchedAt,
      }));
      const { error } = await supabase.from("bar_coverage").upsert(rows, { onConflict: "symbol,timeframe,day" });
      if (error) throw new Error(`bar_coverage upsert failed: ${error.message}`);
    }
  }
}
