/**
 * core/backtest/backtestLoader.ts
 *
 * Loads historical bar data for backtesting from Alpaca's v2 REST API.
 *
 * Two public APIs:
 *   - streamBars (preferred): async generator that fetches all symbols
 *     concurrently page-by-page and yields sorted windows as they arrive.
 *     Allows the BacktestEngine to process window N while window N+1 is
 *     still in flight over the network.
 *   - loadBars: convenience wrapper that collects all windows into a single
 *     sorted array. Kept for backward compatibility (tests, one-off scripts).
 *
 * Inputs:  Symbols, date range, timeframe, Alpaca API credentials.
 * Outputs: Sorted arrays or a stream of normalized Bar objects.
 */

import { env } from "../../config/env";
import { normalizeBar } from "../../adapters/alpaca/normalizer";
import { logger } from "../../utils/logger";
import {
  DAY_MS,
  splitIntoRuns,
  utcDay,
  utcDayStart,
  utcDaysInRange,
  type BarCache,
} from "./barCache";
import type { Bar } from "../../types/market";
import type { Symbol, ISOTimestamp } from "../../types/common";

/** Cached reads are sliced so no single get_bars response grows unbounded. */
const CACHE_READ_SLICE_DAYS = 10;

export interface BacktestLoaderOptions {
  /** Shared bar cache (Part 03). Omit to always fetch from Alpaca. */
  cache?: BarCache;
  /**
   * Days within this many days of today are fetched and written but never
   * marked complete: Alpaca revises recent bars, so they must be re-read.
   */
  settleDays?: number;
  /** Injectable wall clock for the settle cutoff (tests). */
  now?: () => number;
}

export class BacktestLoader {
  private readonly cache?: BarCache;
  private readonly settleDays: number;
  private readonly now: () => number;

  constructor(options: BacktestLoaderOptions = {}) {
    this.cache = options.cache;
    this.settleDays = options.settleDays ?? 1;
    this.now = options.now ?? Date.now;
  }

  /**
   * Fetches historical bars for one or more symbols and returns them as a
   * single sorted array. Symbols are fetched concurrently; pages within each
   * symbol are sequential. Returns bars sorted by (ts asc, symbol asc).
   *
   * Prefer `streamBars` when feeding a BacktestEngine — it pipelines I/O and
   * computation so the engine starts processing page 1 while later pages are
   * still in flight.
   */
  async loadBars(
    symbols: Symbol[],
    startDate: ISOTimestamp,
    endDate: ISOTimestamp,
    timeframe = "1Min",
  ): Promise<Bar[]> {
    const allBars: Bar[] = [];
    for await (const window of this.streamBars(symbols, startDate, endDate, timeframe)) {
      for (const bar of window) allBars.push(bar);
    }
    // streamBars yields already-sorted windows in ascending order;
    // concatenating in yield order preserves the global sort.
    return allBars;
  }

  /**
   * Streams historical bars for all symbols concurrently, yielding sorted
   * windows as they become available. Each yielded window is safe to process
   * immediately — the generator guarantees no future fetch will produce bars
   * at timestamps already yielded, so the BacktestEngine can pipeline I/O
   * with simulation.
   *
   * The "safe horizon" is the minimum last-bar timestamp across all
   * non-exhausted symbol buffers: bars at ts ≤ horizon are complete (no
   * subsequent page can add bars at those timestamps), so timestamp batches
   * are never split across window boundaries.
   */
  async *streamBars(
    symbols: Symbol[],
    startDate: ISOTimestamp,
    endDate: ISOTimestamp,
    timeframe = "1Min",
  ): AsyncGenerator<Bar[]> {
    const iters = symbols.map((s) => this._pageIterator(s, startDate, endDate, timeframe));
    const buffers: Bar[][] = symbols.map(() => []);
    const done: boolean[] = symbols.map(() => false);

    // The safe-horizon logic below reads each buffer's LAST bar as its latest
    // timestamp, so every page must be ascending. Alpaca and the bar cache both
    // return sorted pages; sorting anyway keeps one out-of-order page from
    // stalling the drain loop.
    const byTs = (a: Bar, b: Bar) => a.ts - b.ts;

    // Prime all symbols with their first page concurrently.
    await Promise.all(
      iters.map(async (it, i) => {
        const r = await it.next();
        if (r.done) {
          done[i] = true;
        } else {
          buffers[i].push(...r.value.sort(byTs));
          logger.info("BacktestLoader: first page loaded", {
            symbol: symbols[i], count: buffers[i].length, timeframe,
          });
        }
      }),
    );

    while (true) {
      // Fetch next pages for any empty non-exhausted buffer before computing
      // the horizon, so every active symbol has at least one bar to anchor
      // the safe window against. Multiple empty buffers are refilled in parallel.
      let refilled = false;
      await Promise.all(
        iters.map(async (it, i) => {
          if (done[i] || buffers[i].length > 0) return;
          refilled = true;
          const r = await it.next();
          if (r.done) {
            done[i] = true;
          } else {
            buffers[i].push(...r.value.sort(byTs));
            logger.info("BacktestLoader: page loaded", {
              symbol: symbols[i], count: buffers[i].length,
            });
          }
        }),
      );

      if (done.every((d, i) => d && buffers[i].length === 0)) break;

      // Safe horizon: min last-bar timestamp across all non-exhausted buffers.
      let horizon = Infinity;
      for (let i = 0; i < symbols.length; i++) {
        if (!done[i] && buffers[i].length > 0) {
          horizon = Math.min(horizon, buffers[i][buffers[i].length - 1].ts);
        }
      }

      // Drain everything at ts ≤ horizon from each buffer (or everything if exhausted).
      const window: Bar[] = [];
      for (let i = 0; i < symbols.length; i++) {
        let cut = 0;
        while (cut < buffers[i].length && (done[i] || buffers[i][cut].ts <= horizon)) cut++;
        if (cut > 0) window.push(...buffers[i].splice(0, cut));
      }

      if (window.length > 0) {
        window.sort((a, b) =>
          a.ts !== b.ts ? a.ts - b.ts : a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0,
        );
        yield window;
      } else if (!refilled) {
        // Nothing drained and nothing fetched: the next iteration would see the
        // exact same state. Without this the loop spins synchronously forever —
        // no await ever yields, so not even a timeout can interrupt it.
        throw new Error(
          "BacktestLoader: stream stalled — a later page returned bars earlier than the previous page's last bar",
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  /**
   * One symbol's bars over [startDate, endDate], page by page. With a cache,
   * days already known complete come from it and every other run of days is
   * fetched from Alpaca and backfilled; without one, it is Alpaca throughout.
   */
  private _pageIterator(
    symbol: Symbol,
    startDate: ISOTimestamp,
    endDate: ISOTimestamp,
    timeframe: string,
  ): AsyncGenerator<Bar[]> {
    return this.cache
      ? this._cachedPages(this.cache, symbol, startDate, endDate, timeframe)
      : this._alpacaPages(symbol, startDate, endDate, timeframe);
  }

  private async *_cachedPages(
    cache: BarCache,
    symbol: Symbol,
    startDate: ISOTimestamp,
    endDate: ISOTimestamp,
    timeframe: string,
  ): AsyncGenerator<Bar[]> {
    const startMs = Date.parse(startDate);
    const endMs = Date.parse(endDate);
    const days = utcDaysInRange(startMs, endMs);
    if (days.length === 0) return;

    let complete: Set<string>;
    try {
      complete = await cache.getCompleteDays(symbol, timeframe, days[0], days[days.length - 1]);
    } catch (err) {
      // The cache is an optimization; a broken one must never fail a backtest.
      logger.warn("BacktestLoader: bar cache unavailable, fetching from Alpaca", { symbol, err: String(err) });
      yield* this._alpacaPages(symbol, startDate, endDate, timeframe);
      return;
    }

    const inRange = (b: Bar) => b.ts >= startMs && b.ts <= endMs;
    let cachedBars = 0;
    let fetchedBars = 0;

    for (const run of splitIntoRuns(days, complete)) {
      const runStart = utcDayStart(run.days[0]);
      const runEnd = utcDayStart(run.days[run.days.length - 1]) + DAY_MS;

      if (run.cached) {
        let readFailed = false;
        for (let from = runStart; from < runEnd; from += CACHE_READ_SLICE_DAYS * DAY_MS) {
          const to = Math.min(runEnd, from + CACHE_READ_SLICE_DAYS * DAY_MS);
          let slice: Bar[];
          try {
            slice = await cache.readBars(symbol, timeframe, Math.max(from, startMs), Math.min(to, endMs + 1));
          } catch (err) {
            logger.warn("BacktestLoader: cache read failed, fetching the rest of this span from Alpaca", {
              symbol, err: String(err),
            });
            // Resume from the first unread instant so nothing already yielded repeats.
            yield* this._fetchAndBackfill(cache, symbol, timeframe, Math.max(from, startMs), runEnd, inRange, false);
            readFailed = true;
            break;
          }
          cachedBars += slice.length;
          if (slice.length > 0) yield slice;
        }
        if (readFailed) continue;
      } else {
        fetchedBars += yield* this._fetchAndBackfill(cache, symbol, timeframe, runStart, runEnd, inRange, true);
      }
    }

    logger.info("BacktestLoader: bars loaded", { symbol, timeframe, cachedBars, fetchedBars });
  }

  /**
   * Fetches [fromMs, toMs) from Alpaca, yields the in-range bars, and writes
   * every fetched bar to the cache. When `markDays` is set (the span covers
   * whole days), days older than the settle cutoff are recorded complete —
   * but only if every write succeeded, so a partial backfill is retried later.
   * @returns number of bars yielded
   */
  private async *_fetchAndBackfill(
    cache: BarCache,
    symbol: Symbol,
    timeframe: string,
    fromMs: number,
    toMs: number,
    inRange: (b: Bar) => boolean,
    markDays: boolean,
  ): AsyncGenerator<Bar[], number> {
    const counts = new Map<string, number>();
    let writes: Promise<void> = Promise.resolve();
    let writeFailed = false;
    let yielded = 0;

    // Alpaca's end bound is inclusive; stop 1ms short of the next day.
    for await (const page of this._alpacaPages(
      symbol,
      new Date(fromMs).toISOString(),
      new Date(toMs - 1).toISOString(),
      timeframe,
    )) {
      const owned = page.filter((b) => b.ts >= fromMs && b.ts < toMs);
      for (const b of owned) {
        const day = utcDay(b.ts);
        counts.set(day, (counts.get(day) ?? 0) + 1);
      }
      // Chained, not awaited: writing page N overlaps fetching page N+1.
      writes = writes.then(() =>
        writeFailed
          ? undefined
          : cache.writeBars(symbol, timeframe, owned).catch((err) => {
              writeFailed = true;
              logger.warn("BacktestLoader: bar cache write failed — days stay uncached", {
                symbol, err: String(err),
              });
            }),
      );
      const wanted = owned.filter(inRange);
      yielded += wanted.length;
      if (wanted.length > 0) yield wanted;
    }

    await writes;
    if (!markDays || writeFailed) return yielded;

    const settleCutoff = utcDay(this.now() - this.settleDays * DAY_MS);
    const settled: { day: string; barCount: number }[] = [];
    for (let d = fromMs; d < toMs; d += DAY_MS) {
      const day = utcDay(d);
      if (day < settleCutoff) settled.push({ day, barCount: counts.get(day) ?? 0 });
    }
    if (settled.length > 0) {
      await cache.markComplete(symbol, timeframe, settled).catch((err) =>
        logger.warn("BacktestLoader: bar coverage write failed", { symbol, err: String(err) }),
      );
    }
    return yielded;
  }

  /**
   * Async generator that yields one page of normalized bars per iteration
   * for a single symbol, following Alpaca's next_page_token pagination.
   */
  private async *_alpacaPages(
    symbol: Symbol,
    startDate: ISOTimestamp,
    endDate: ISOTimestamp,
    timeframe: string,
  ): AsyncGenerator<Bar[]> {
    const baseUrl = "https://data.alpaca.markets/v2";
    const headers = {
      "APCA-API-KEY-ID": env.alpacaApiKey,
      "APCA-API-SECRET-KEY": env.alpacaApiSecret,
    };
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        start: startDate,
        end: endDate,
        timeframe,
        limit: "10000",
        adjustment: "raw",
        ...(pageToken ? { page_token: pageToken } : {}),
      });

      const url = `${baseUrl}/stocks/${symbol}/bars?${params.toString()}`;
      const response = await this._fetchWithRetry(url, { headers });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `BacktestLoader: failed to fetch bars for ${symbol} | Status: ${response.status} ${response.statusText} | Body: ${text}`,
        );
      }

      const json = (await response.json()) as {
        bars: Record<string, unknown>[];
        next_page_token?: string;
      };

      const page: Bar[] = (json.bars ?? []).map((raw) =>
        normalizeBar({ ...raw, S: symbol } as never, timeframe),
      );
      if (page.length > 0) yield page;

      pageToken = json.next_page_token;
    } while (pageToken);
  }

  /**
   * Wraps fetch with exponential-backoff retries for transient network errors
   * (ECONNRESET, ETIMEDOUT, fetch failed) and server-side 5xx / 429 responses.
   * Client errors (4xx except 429) are not retried.
   */
  private async _fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries = 3,
    baseBackoffMs = 500,
  ): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = baseBackoffMs * 2 ** (attempt - 1);
        logger.warn("BacktestLoader: retrying fetch", { url, attempt, delayMs: delay });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      try {
        const response = await fetch(url, options);
        if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
          lastError = new Error(`HTTP ${response.status}`);
          continue;
        }
        return response;
      } catch (err) {
        lastError = err;
        if (!this._isTransientError(err) || attempt === maxRetries) throw err;
      }
    }

    throw lastError;
  }

  private _isTransientError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = (
      err.message + (err.cause instanceof Error ? " " + err.cause.message : "")
    ).toLowerCase();
    return (
      msg.includes("econnreset") ||
      msg.includes("econnrefused") ||
      msg.includes("etimedout") ||
      msg.includes("fetch failed")
    );
  }
}
