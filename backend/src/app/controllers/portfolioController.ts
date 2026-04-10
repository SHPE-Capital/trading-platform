/**
 * app/controllers/portfolioController.ts
 *
 * Controller for portfolio-related endpoints.
 * Returns the current portfolio snapshot, open positions, order history,
 * fills, and the equity curve for charting.
 *
 * Inputs:  HTTP requests from the frontend portfolio view.
 * Outputs: JSON portfolio data from in-memory state or database.
 */

import type { Request, Response } from "express";
import {
  getLatestPortfolioSnapshot,
  getPortfolioEquityCurve,
  getOrdersByStrategyRun,
} from "../../adapters/supabase/repositories";
import { logger } from "../../utils/logger";

/**
 * GET /api/portfolio/snapshot
 * Returns the most recent portfolio snapshot.
 * @param req - Express Request
 * @param res - Express Response: PortfolioSnapshot JSON or 404
 */
export async function getPortfolioSnapshot(req: Request, res: Response): Promise<void> {
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

/**
 * GET /api/portfolio/equity-curve
 * Returns the historical equity curve snapshots for charting.
 * Query param: ?limit=500
 * @param req - Express Request with optional query.limit
 * @param res - Express Response: PortfolioSnapshot[] JSON array
 */
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

/**
 * GET /api/portfolio/orders
 * Returns order history for a strategy run.
 * Query param: ?strategyRunId=<uuid>
 * @param req - Express Request with query.strategyRunId
 * @param res - Express Response: Order[] JSON array
 */
export async function getOrders(req: Request, res: Response): Promise<void> {
  const strategyRunId = req.query["strategyRunId"] as string | undefined;
  if (!strategyRunId) {
    res.status(400).json({ error: "strategyRunId query parameter is required" });
    return;
  }
  try {
    const orders = await getOrdersByStrategyRun(strategyRunId);
    res.json(orders);
  } catch (err) {
    logger.error("getOrders error", { err });
    res.status(500).json({ error: "Failed to fetch orders" });
  }
}
