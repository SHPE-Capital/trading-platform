import type { Request, Response } from "express";
import {
  getAllStrategyRuns,
  getAllStrategies,
  getStrategyById,
  insertStrategy,
  updateStrategy,
  deleteStrategy,
} from "../../adapters/supabase/repositories";
import { STRATEGY_DEFINITIONS } from "../../config/strategyDefaults";
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

// ------------------------------------------------------------------
// Strategy Config CRUD
// ------------------------------------------------------------------

/** GET /api/strategies/configs */
export async function listStrategies(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await getAllStrategies());
  } catch (err) {
    logger.error("listStrategies error", { err });
    res.status(500).json({ error: "Failed to fetch strategies" });
  }
}

/** GET /api/strategies/configs/defaults/:type */
export async function getStrategyDefaults(req: Request, res: Response): Promise<void> {
  const type = String(req.params.type);
  const def = STRATEGY_DEFINITIONS[type];
  if (!def) {
    res.status(404).json({ error: `No default config for strategy type: ${type}` });
    return;
  }
  res.json(def);
}

/** POST /api/strategies/configs — body: { strategy_type, name, config } */
export async function createStrategy(req: Request, res: Response): Promise<void> {
  const { strategy_type, name, config } = req.body as {
    strategy_type: string;
    name: string;
    config: Record<string, unknown>;
  };
  if (!strategy_type || !name || !config) {
    res.status(400).json({ error: "strategy_type, name, and config are required" });
    return;
  }
  const def = STRATEGY_DEFINITIONS[strategy_type];
  if (!def) {
    res.status(400).json({ error: `Unknown strategy type: ${strategy_type}` });
    return;
  }
  try {
    const strategy = await insertStrategy({ strategy_type, version: def.version, name, config });
    res.status(201).json(strategy);
  } catch (err) {
    logger.error("createStrategy error", { err });
    res.status(500).json({ error: "Failed to create strategy" });
  }
}

/** PUT /api/strategies/configs/:configId — body: { name, config } */
export async function updateStrategyConfig(req: Request, res: Response): Promise<void> {
  const configId = String(req.params.configId);
  const { name, config } = req.body as { name: string; config: Record<string, unknown> };
  if (!name || !config) {
    res.status(400).json({ error: "name and config are required" });
    return;
  }
  try {
    const existing = await getStrategyById(configId);
    if (!existing) {
      res.status(404).json({ error: `Strategy ${configId} not found` });
      return;
    }
    await updateStrategy(configId, name, config);
    res.json({ message: "Strategy updated" });
  } catch (err) {
    logger.error("updateStrategyConfig error", { err });
    res.status(500).json({ error: "Failed to update strategy" });
  }
}

/** DELETE /api/strategies/configs/:configId */
export async function deleteStrategyConfig(req: Request, res: Response): Promise<void> {
  const configId = String(req.params.configId);
  try {
    await deleteStrategy(configId);
    res.json({ message: "Strategy deleted" });
  } catch (err) {
    logger.error("deleteStrategyConfig error", { err });
    res.status(500).json({ error: "Failed to delete strategy" });
  }
}
