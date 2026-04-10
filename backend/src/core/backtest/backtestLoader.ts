/**
 * core/backtest/backtestLoader.ts
 *
 * Loads historical bar or quote data for backtesting.
 * Fetches data from Alpaca's historical data REST API and normalizes it
 * into internal Bar or Quote objects ready for the backtest engine.
 *
 * Inputs:  Symbols, date range, timeframe, Alpaca API credentials.
 * Outputs: Sorted arrays of normalized Bar objects for the backtest engine.
 */

import { env } from "../../config/env";
import { normalizeBar } from "../../adapters/alpaca/normalizer";
import { logger } from "../../utils/logger";
import type { Bar } from "../../types/market";
import type { Symbol, ISOTimestamp } from "../../types/common";

export class BacktestLoader {
  /**
   * Fetches historical bars from Alpaca for one or more symbols over a date range.
   * Returns all bars sorted by timestamp ascending, interleaved across symbols.
   *
   * @param symbols - List of ticker symbols to fetch
   * @param startDate - Period start (ISO 8601)
   * @param endDate - Period end (ISO 8601)
   * @param timeframe - Bar timeframe (e.g. "1Min", "5Min", "1Day")
   * @returns Sorted array of normalized Bar objects
   */
  async loadBars(
    symbols: Symbol[],
    startDate: ISOTimestamp,
    endDate: ISOTimestamp,
    timeframe = "1Min",
  ): Promise<Bar[]> {
    const allBars: Bar[] = [];

    for (const symbol of symbols) {
      const bars = await this._fetchBarsForSymbol(symbol, startDate, endDate, timeframe);
      allBars.push(...bars);
      logger.info("BacktestLoader: loaded bars", { symbol, count: bars.length, timeframe });
    }

    // Sort all bars across symbols by timestamp ascending
    allBars.sort((a, b) => a.ts - b.ts);
    return allBars;
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  /**
   * Fetches paginated historical bars for a single symbol from Alpaca v2 API.
   * @param symbol - Ticker symbol
   * @param startDate - Start date ISO string
   * @param endDate - End date ISO string
   * @param timeframe - Alpaca timeframe string
   * @returns Array of normalized Bar objects
   */
  private async _fetchBarsForSymbol(
    symbol: Symbol,
    startDate: ISOTimestamp,
    endDate: ISOTimestamp,
    timeframe: string,
  ): Promise<Bar[]> {
    const baseUrl = "https://data.alpaca.markets/v2";
    const bars: Bar[] = [];
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
      const response = await fetch(url, {
        headers: {
          "APCA-API-KEY-ID": env.alpacaApiKey,
          "APCA-API-SECRET-KEY": env.alpacaApiSecret,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`BacktestLoader: failed to fetch bars for ${symbol}: ${text}`);
      }

      const json = (await response.json()) as {
        bars: Record<string, unknown>[];
        next_page_token?: string;
      };

      for (const raw of json.bars ?? []) {
        bars.push(normalizeBar({ ...raw, S: symbol } as never, timeframe));
      }

      pageToken = json.next_page_token;
    } while (pageToken);

    return bars;
  }
}
