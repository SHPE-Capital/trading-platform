/**
 * core/analytics/benchmark.ts
 *
 * Buy-and-hold of a benchmark (SPY by default) over a run's or strategy's
 * window, for "did this beat just holding the market?". Bars come through the
 * shared bar cache, so a window anyone has backtested or viewed costs nothing.
 */

export interface BenchmarkBarLoader {
  loadBars(symbols: string[], start: string, end: string, timeframe: string): Promise<{ ts: number; close: number }[]>;
}

const DAY_MS = 86_400_000;

/**
 * Closes of `symbol` across [startMs, endMs] as { ts, value } — daily bars for
 * windows over three days, minute bars otherwise. Empty when no bars exist.
 */
export async function loadBenchmarkCurve(
  loader: BenchmarkBarLoader,
  symbol: string,
  startMs: number,
  endMs: number,
): Promise<{ ts: number; value: number }[]> {
  if (!(endMs > startMs)) return [];
  const timeframe = endMs - startMs > 3 * DAY_MS ? "1Day" : "1Min";
  // Daily bars are stamped at midnight; reach back a day so the first session is included.
  const from = timeframe === "1Day" ? startMs - DAY_MS : startMs;
  const bars = await loader.loadBars([symbol], new Date(from).toISOString(), new Date(endMs).toISOString(), timeframe);
  return bars
    .filter((b) => b.ts <= endMs)
    .map((b) => ({ ts: Math.max(b.ts, startMs), value: b.close }));
}

/** The benchmark as dollar PnL on `capitalBase`, for overlaying on a run's PnL curve. */
export function benchmarkPnl(curve: { ts: number; value: number }[], capitalBase: number): { ts: number; pnl: number }[] {
  const first = curve[0]?.value;
  if (!first) return [];
  return curve.map((p) => ({ ts: p.ts, pnl: capitalBase * (p.value / first - 1) }));
}
