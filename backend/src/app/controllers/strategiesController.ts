/**
 * app/controllers/strategiesController.ts
 *
 * Controller for strategy management endpoints.
 * Handles creating, starting, stopping, and listing strategy runs.
 * Delegates to the core Orchestrator for lifecycle management.
 *
 * Inputs:  HTTP requests from the frontend strategy management UI.
 * Outputs: JSON responses with strategy run state and metadata.
 */

import type { Request, Response } from "express";
import { getAllStrategyRuns } from "../../adapters/supabase/repositories";
import { logger } from "../../utils/logger";

/**
 * GET /api/strategies
 * Returns all strategy run records from the database.
 * @param req - Express Request
 * @param res - Express Response: StrategyRun[] JSON array
 */
export async function listStrategyRuns(req: Request, res: Response): Promise<void> {
  try {
    const runs = await getAllStrategyRuns();
    res.json(runs);
  } catch (err) {
    logger.error("listStrategyRuns error", { err });
    res.status(500).json({ error: "Failed to fetch strategy runs" });
  }
}

/**
 * GET /api/strategies/:id
 * Returns a single strategy run by ID.
 * @param req - Express Request with params.id
 * @param res - Express Response: StrategyRun JSON or 404
 */
export async function getStrategyRun(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  try {
    const runs = await getAllStrategyRuns();
    const run = runs.find((r) => r.id === id);
    if (!run) {
      res.status(404).json({ error: `Strategy run ${id} not found` });
      return;
    }
    res.json(run);
  } catch (err) {
    logger.error("getStrategyRun error", { id, err });
    res.status(500).json({ error: "Failed to fetch strategy run" });
  }
}

/**
 * POST /api/strategies/start
 * Creates and starts a new strategy run.
 * Body: { strategyType: string, config: BaseStrategyConfig }
 * @param req - Express Request with strategy config in body
 * @param res - Express Response: { message: string, strategyId: string }
 */
export async function startStrategyRun(req: Request, res: Response): Promise<void> {
  const { strategyType, config } = req.body as { strategyType: string; config: unknown };

  if (!strategyType || !config) {
    res.status(400).json({ error: "strategyType and config are required" });
    return;
  }

  // TODO: Instantiate strategy from config and register with the live Orchestrator
  logger.info("startStrategyRun: received request", { strategyType });
  res.status(501).json({ error: "Not yet implemented — connect to Orchestrator instance" });
}

/**
 * POST /api/strategies/:id/stop
 * Stops a running strategy run.
 * @param req - Express Request with params.id
 * @param res - Express Response: { message: string }
 */
export async function stopStrategyRun(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  // TODO: Deregister strategy from the live Orchestrator
  logger.info("stopStrategyRun: received request", { id });
  res.status(501).json({ error: "Not yet implemented — connect to Orchestrator instance" });
}
