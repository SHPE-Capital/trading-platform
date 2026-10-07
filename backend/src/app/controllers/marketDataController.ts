import type { Request, Response } from "express";
import { logger } from "../../utils/logger";
import { SupabaseBarCache } from "../../adapters/supabase/barCacheRepository";
import { utcDay } from "../../core/backtest/barCache";
import type { AppContext } from "../context";

/**
 * GET /api/market-data/symbols
 */
export async function getTrackedSymbols(req: Request, res: Response): Promise<void> {
  const { symbolState } = req.app.locals.ctx as AppContext;
  if (!symbolState) {
    res.json([]);
    return;
  }
  res.json(symbolState.getSymbols());
}

/**
 * GET /api/market-data/snapshot/:symbol
 */
export async function getSymbolSnapshot(req: Request, res: Response): Promise<void> {
  const { symbol } = req.params;
  const { symbolState } = req.app.locals.ctx as AppContext;
  if (!symbolState) {
    res.status(404).json({ error: `No live data for ${symbol}` });
    return;
  }
  const state = symbolState.get(String(symbol));
  if (!state) {
    logger.debug("getSymbolSnapshot: symbol not tracked", { symbol });
    res.status(404).json({ error: `No live data for ${symbol}` });
    return;
  }
  res.json(state);
}

/** Longest range one bars request may cover. */
const MAX_BARS_RANGE_MS = 31 * 86_400_000;

/**
 * GET /api/market-data/bars?symbol=&from=&to=&timeframe=1Min
 *
 * Cached bars and their known-complete days, for `npm run data:pull` to seed a
 * member's local sim replay. Served from the bar cache only — it never calls
 * Alpaca, so members pulling data cannot spend the club's request quota.
 */
export async function getCachedBars(req: Request, res: Response): Promise<void> {
  const symbol = String(req.query["symbol"] ?? "").toUpperCase();
  const timeframe = String(req.query["timeframe"] ?? "1Min");
  const fromMs = Date.parse(String(req.query["from"] ?? ""));
  const toMs = Date.parse(String(req.query["to"] ?? ""));
  if (!symbol || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    res.status(400).json({ error: "symbol, from and to (ISO dates, from < to) are required" });
    return;
  }
  if (toMs - fromMs > MAX_BARS_RANGE_MS) {
    res.status(400).json({ error: "A bars request may cover at most 31 days" });
    return;
  }
  try {
    const cache = new SupabaseBarCache();
    const [bars, completeDays] = await Promise.all([
      cache.readBars(symbol, timeframe, fromMs, toMs),
      cache.getCompleteDays(symbol, timeframe, utcDay(fromMs), utcDay(toMs)),
    ]);
    res.json({ symbol, timeframe, bars, completeDays: [...completeDays].sort() });
  } catch (err) {
    logger.error("getCachedBars failed", { symbol, err: String(err) });
    res.status(500).json({ error: "Failed to read cached bars" });
  }
}
