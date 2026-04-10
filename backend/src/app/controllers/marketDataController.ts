/**
 * app/controllers/marketDataController.ts
 *
 * Controller for market data endpoints.
 * Returns current symbol state snapshots and recent quote/trade history
 * from the in-memory SymbolStateManager for frontend display.
 *
 * Inputs:  HTTP requests from the frontend dashboard.
 * Outputs: JSON symbol state and market data snapshots.
 */

import type { Request, Response } from "express";
import { logger } from "../../utils/logger";

/**
 * GET /api/market-data/symbols
 * Returns the list of symbols currently tracked in the engine's symbol state.
 * @param req - Express Request
 * @param res - Express Response: string[] symbol list
 */
export async function getTrackedSymbols(req: Request, res: Response): Promise<void> {
  // TODO: Return symbols from the live SymbolStateManager
  res.json([]);
}

/**
 * GET /api/market-data/snapshot/:symbol
 * Returns the latest quote snapshot for a specific symbol.
 * @param req - Express Request with params.symbol
 * @param res - Express Response: Quote JSON or 404
 */
export async function getSymbolSnapshot(req: Request, res: Response): Promise<void> {
  const { symbol } = req.params;
  // TODO: Query live SymbolStateManager for symbol state
  logger.debug("getSymbolSnapshot", { symbol });
  res.status(404).json({ error: `No live data for ${symbol}` });
}
