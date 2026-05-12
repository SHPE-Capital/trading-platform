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

/** GET /api/portfolio/equity-curve — query param: ?limit=500 */
export async function getEquityCurve(req: Request, res: Response): Promise<void> {
  const limit = parseInt(String(req.query["limit"] ?? "500"), 10);
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
