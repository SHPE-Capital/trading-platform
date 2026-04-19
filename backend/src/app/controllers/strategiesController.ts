import type { Request, Response } from "express";
import { getAllStrategyRuns } from "../../adapters/supabase/repositories";
import { logger } from "../../utils/logger";
import type { AppContext } from "../context";

/**
 * GET /api/strategies
 */
export async function listStrategyRuns(_req: Request, res: Response): Promise<void> {
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
 * Body: { strategyType: string, config: BaseStrategyConfig }
 * TODO: Add a strategy factory/registry so strategies can be instantiated from JSON config.
 */
export async function startStrategyRun(req: Request, res: Response): Promise<void> {
  const { strategyType, config } = req.body as { strategyType: string; config: unknown };
  if (!strategyType || !config) {
    res.status(400).json({ error: "strategyType and config are required" });
    return;
  }
  const { orchestrator } = req.app.locals.ctx as AppContext;
  if (!orchestrator) {
    res.status(503).json({ error: "Orchestrator not available in this runtime mode" });
    return;
  }
  logger.info("startStrategyRun: received request", { strategyType });
  res.status(501).json({ error: "Strategy factory not yet implemented" });
}

/**
 * POST /api/strategies/:id/stop
 */
export async function stopStrategyRun(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { orchestrator } = req.app.locals.ctx as AppContext;
  if (!orchestrator) {
    res.status(503).json({ error: "Orchestrator not available in this runtime mode" });
    return;
  }
  orchestrator.deregisterStrategy(String(id));
  logger.info("stopStrategyRun: strategy deregistered", { id });
  res.json({ message: `Strategy ${id} stopped` });
}
