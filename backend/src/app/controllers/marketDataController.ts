import type { Request, Response } from "express";
import { logger } from "../../utils/logger";
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
