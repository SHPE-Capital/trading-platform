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
import type { Bar } from "../../types/market";
import type { Symbol, ISOTimestamp } from "../../types/common";

export class BacktestLoader {
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

    // Prime all symbols with their first page concurrently.
    await Promise.all(
      iters.map(async (it, i) => {
        const r = await it.next();
        if (r.done) {
          done[i] = true;
        } else {
          buffers[i].push(...r.value);
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
      await Promise.all(
        iters.map(async (it, i) => {
          if (done[i] || buffers[i].length > 0) return;
          const r = await it.next();
          if (r.done) {
            done[i] = true;
          } else {
            buffers[i].push(...r.value);
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
      }
    }
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  /**
   * Async generator that yields one page of normalized bars per iteration
   * for a single symbol, following Alpaca's next_page_token pagination.
   */
  private async *_pageIterator(
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
