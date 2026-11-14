/**
 * app/controllers/portfolioController.ts
 *
 * Controller for portfolio-related endpoints.
 * Returns the current portfolio snapshot, open positions, order history,
 * fills, and the equity curve for charting.
 */

import type { Request, Response } from "express";
import {
  getLatestPortfolioSnapshot,
  getPortfolioEquityCurve,
  getOrdersByStrategyRun,
  getAllOrders,
  getRecentFills,
} from "../../adapters/supabase/repositories";
import { logger } from "../../utils/logger";
import type { AppContext } from "../context";

/** GET /api/portfolio/snapshot */
export async function getPortfolioSnapshot(req: Request, res: Response): Promise<void> {
  const { portfolioState } = req.app.locals.ctx as AppContext;
  if (portfolioState) {
    res.json(portfolioState.getSnapshot());
    return;
  }
  try {
    const snapshot = await getLatestPortfolioSnapshot();
    if (!snapshot) {
      res.status(404).json({ error: "No portfolio snapshot found" });
      return;
    }
    res.json(snapshot);
  } catch (err) {
    logger.error("getPortfolioSnapshot error", { err });
    res.status(500).json({ error: "Failed to fetch portfolio snapshot" });
  }
}

/** Upper bound on ?limit= for the equity curve (~3.5 days of 60s snapshots). */
const MAX_EQUITY_CURVE_LIMIT = 5000;

/** GET /api/portfolio/equity-curve — query param: ?limit=500 (clamped to 1..5000) */
export async function getEquityCurve(req: Request, res: Response): Promise<void> {
  // A non-numeric limit parses to NaN, which supabase-js drops (unbounded read);
  // a negative one is a PostgREST range error that the repository turns into [].
  const parsed = parseInt(String(req.query["limit"] ?? "500"), 10);
  const limit = Number.isNaN(parsed) ? 500 : Math.min(MAX_EQUITY_CURVE_LIMIT, Math.max(1, parsed));
  try {
    const curve = await getPortfolioEquityCurve(limit);
    res.json(curve);
  } catch (err) {
    logger.error("getEquityCurve error", { err });
    res.status(500).json({ error: "Failed to fetch equity curve" });
  }
}

/** GET /api/portfolio/orders — optional query param: ?strategyRunId=<uuid>
 *  Omitting strategyRunId returns all orders (newest first, up to 500). */
export async function getOrders(req: Request, res: Response): Promise<void> {
  const strategyRunId = req.query["strategyRunId"] as string | undefined;
  try {
    const orders = strategyRunId
      ? await getOrdersByStrategyRun(strategyRunId)
      : await getAllOrders();
    res.json(orders);
  } catch (err) {
    logger.error("getOrders error", { err });
    res.status(500).json({ error: "Failed to fetch orders" });
  }
}

/** GET /api/portfolio/fills — the most recent fills (newest first, up to 500) */
export async function getFills(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await getRecentFills());
  } catch (err) {
    logger.error("getFills error", { err });
    res.status(500).json({ error: "Failed to fetch fills" });
  }
}
