import type { Request, Response } from "express";
import {
  getAllStrategyRuns,
  getStrategyRunById,
  getAllStrategies,
  getStrategyById,
  insertStrategy,
  insertStrategyRun,
  updateStrategyRun,
  deleteStrategy,
  countRunningRunsForOwner,
  getStrategyHistoryCounts,
  StrategyAlreadyLiveError,
} from "../../adapters/supabase/repositories";
import { getStrategyVersionById, insertStrategyVersion, saveStrategyVersion } from "../../adapters/supabase/reviewRepositories";
import { STRATEGY_DEFINITIONS, STRATEGY_FACTORY } from "../../config/strategyDefaults";
import { env } from "../../config/env";
import { newId } from "../../utils/ids";
import { nowMs } from "../../utils/time";
import { logger } from "../../utils/logger";
import type { AppContext } from "../context";
import type { StrategyRun, StrategyType } from "../../types/strategy";
import type { UUID } from "../../types/common";

/**
 * GET /api/strategies
 * Returns all strategy run records enriched with a live `isLive` flag that
 * reflects whether the strategy is actively registered in the orchestrator.
 * The DB status can lag (e.g. after a server restart); `isLive` is the
 * authoritative source for whether the strategy is actually executing.
 */
export async function listStrategyRuns(req: Request, res: Response): Promise<void> {
  try {
    const runs = await getAllStrategyRuns();
    const { orchestrator } = req.app.locals.ctx as AppContext;
    const enriched = runs.map((run) => ({
      ...run,
      isLive: orchestrator?.hasStrategy(run.id) ?? false,
    }));
    res.json(enriched);
  } catch (err) {
    logger.error("listStrategyRuns error", { err });
    res.status(500).json({ error: "Failed to fetch strategy runs" });
  }
}

/**
 * GET /api/strategies/:id
 */
export async function getStrategyRun(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  try {
    const run = await getStrategyRunById(id);
    if (!run) {
      res.status(404).json({ error: `Strategy run ${id} not found` });
      return;
    }
    const { orchestrator } = req.app.locals.ctx as AppContext;
    res.json({ ...run, isLive: orchestrator?.hasStrategy(run.id) ?? false });
  } catch (err) {
    logger.error("getStrategyRun error", { id, err });
    res.status(500).json({ error: "Failed to fetch strategy run" });
  }
}

/**
 * POST /api/strategies/start
 * Body: { strategyId: UUID, versionId: UUID }
 *
 * Instantiates the strategy via STRATEGY_FACTORY, registers it with the
 * live orchestrator, persists a strategy_runs row, and returns the run record.
 * If the orchestrator has a marketDataAdapter (live mode), new symbols are
 * subscribed automatically.
 */
export async function startStrategyRun(req: Request, res: Response): Promise<void> {
  const { strategyId, versionId } = req.body as {
    strategyId?: string;
    versionId?: string;
  };
  if (!strategyId || !versionId) {
    res.status(400).json({ error: "strategyId and versionId are required; sandbox runs use an immutable saved version" });
    return;
  }
  const configId = strategyId;

  const { orchestrator, liveRuns, executionMode } = req.app.locals.ctx as AppContext;
  if (!orchestrator || !liveRuns) {
    res.status(503).json({ error: "Orchestrator not available in this runtime mode" });
    return;
  }
  if (executionMode !== "paper") {
    res.status(403).json({
      error: "Self-service starts are paper-only",
      detail: "Real-money runs must be started through lead approval.",
    });
    return;
  }

  const saved = await getStrategyById(configId);
  if (!saved) {
    res.status(404).json({ error: `Saved strategy ${configId} not found` });
    return;
  }
  if (req.user!.role !== "lead" && saved.owner_id !== req.user!.id) {
    res.status(403).json({ error: "Only the strategy owner or a lead may start this sandbox run" });
    return;
  }
  const version = await getStrategyVersionById(versionId);
  if (!version || version.strategyId !== configId) {
    res.status(400).json({ error: "versionId does not belong to this strategy" });
    return;
  }
  const strategyType = saved.strategy_type;
  const factory = STRATEGY_FACTORY[strategyType];
  if (!factory) {
    res.status(400).json({ error: `Unknown strategy type: ${strategyType}` });
    return;
  }

  if (orchestrator.hasStrategyWithConfigId(configId)) {
    res.status(409).json({ error: `A strategy from config ${configId} is already running` });
    return;
  }

  const activeRuns = await countRunningRunsForOwner(req.user!.id, "paper", env.runtimeOrigin);
  if (activeRuns >= env.sandboxMaxActiveRunsPerMember) {
    res.status(429).json({
      error: `Paper sandbox limit reached (${env.sandboxMaxActiveRunsPerMember} active runs per member)`,
      detail: "Stop an existing sandbox before starting another.",
    });
    return;
  }

  const persistedConfig = version.config;
  const requestedBudget = (persistedConfig.riskBudget as Record<string, unknown> | undefined) ?? {};
  const requestedCap = typeof requestedBudget.maxCapitalPct === "number"
    ? requestedBudget.maxCapitalPct
    : env.sandboxMaxCapitalPct;
  const runId = newId();
  const expiresAt = nowMs() + env.sandboxRunTtlHours * 60 * 60 * 1000;
  const effectiveConfig = {
    ...persistedConfig,
    id: configId,
    name: saved.name,
    riskBudget: {
      ...requestedBudget,
      maxCapitalPct: Math.min(requestedCap, env.sandboxMaxCapitalPct),
    },
  };
  const strategy = factory(effectiveConfig);

  await liveRuns.prepare(strategy);

  const run: StrategyRun = {
    id: runId,
    strategyId: effectiveConfig.id as UUID,
    strategyType: strategyType as StrategyType,
    strategyVersion: strategy.version,
    name: saved.name,
    config: effectiveConfig as unknown as StrategyRun["config"],
    status: "running",
    executionMode: "paper",
    runtimeOrigin: env.runtimeOrigin,
    buildSha: env.buildSha,
    buildDirty: env.buildDirty,
    startedAt: nowMs(),
    expiresAt,
    totalSignals: 0,
    totalOrders: 0,
    realizedPnl: 0,
    versionId: version.id,
    ownerId: req.user!.id,
    meta: { sandbox: true },
    ...liveRuns.leaseFields(),
  };

  // Persist (already leased to this runner) before trading: a crash in between
  // leaves a leased running row that gets adopted, never a strategy trading
  // with no row behind it.
  try {
    await insertStrategyRun(run);
  } catch (err) {
    if (err instanceof StrategyAlreadyLiveError) {
      res.status(409).json({ error: err.message });
      return;
    }
    logger.error("startStrategyRun: DB persist failed — strategy not started", { runId, err });
    res.status(500).json({ error: "Failed to persist strategy run" });
    return;
  }

  liveRuns.activate(runId, strategy, expiresAt);
  logger.info("startStrategyRun: strategy started", { runId, strategyId: strategy.id, strategyType });
  res.status(201).json(run);
}

/**
 * POST /api/strategies/:id/stop
 *
 * Deregisters the strategy from the orchestrator (emits STRATEGY_STOPPED),
 * then marks the run as stopped in the database.
 */
export async function stopStrategyRun(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id) as UUID;
  const { orchestrator, liveRuns } = req.app.locals.ctx as AppContext;
  if (!orchestrator || !liveRuns) {
    res.status(503).json({ error: "Orchestrator not available in this runtime mode" });
    return;
  }

  const run = await getStrategyRunById(id);
  if (!run) {
    res.status(404).json({ error: `Strategy run ${id} not found` });
    return;
  }
  if (req.user!.role !== "lead" && run.ownerId !== req.user!.id) {
    res.status(403).json({ error: "Only the run owner or a lead may stop this strategy" });
    return;
  }

  if (!orchestrator.hasStrategy(id)) {
    // Not traded here — either lost on restart or leased to another runner.
    // Marking the row stopped is still right: the runner holding it sees the
    // run leave "running" on its next heartbeat and stops trading it.
    logger.warn("stopStrategyRun: strategy not in this runner — marking the run stopped", { id });
  }

  // Row first, then the lease: releasing a still-"running" row would let another
  // runner adopt it straight back.
  try {
    await updateStrategyRun(id, { status: "stopped", stoppedAt: nowMs() });
    await liveRuns.deactivate(id);
  } catch (err) {
    logger.error("stopStrategyRun: status write failed — retaining lease", { id, err });
    res.status(500).json({ error: "Failed to stop strategy safely" });
    return;
  }
  logger.info("stopStrategyRun: strategy stopped", { id });
  res.json({ message: `Strategy ${id} stopped` });
}

// ------------------------------------------------------------------
// Strategy Config CRUD
// ------------------------------------------------------------------

/** GET /api/strategies/configs */
export async function listStrategies(_req: Request, res: Response): Promise<void> {
  try {
    const rows = await getAllStrategies();
    // Enrich each row with the current algorithm version from the class — this is
    // the single source of truth and does not depend on any stored DB column.
    const enriched = rows.map((s) => ({
      ...s,
      algorithmVersion: STRATEGY_DEFINITIONS[s.strategy_type]?.algorithmVersion,
    }));
    res.json(enriched);
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

/**
 * POST /api/strategies/configs — body: { strategy_type, name, config }
 *
 * Every strategy gets its v1 strategy_versions row here, at creation — not only
 * on a later edit. Without this, a strategy saved and proposed without ever
 * being edited first has no version for a proposal to cite (createProposal
 * 400s with "no versions yet"). If the version insert fails, the strategy row
 * is rolled back rather than left orphaned with zero history.
 */
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
    const strategy = await insertStrategy({ strategy_type, name, config, owner_id: req.user!.id });

    try {
      await insertStrategyVersion({
        strategyId: strategy.id,
        config,
        changeSummary: "Initial version",
        createdBy: req.user!.id,
      });
    } catch (versionErr) {
      await deleteStrategy(strategy.id);
      throw versionErr;
    }

    // Enrich the response with the current algorithm version so the frontend has
    // it immediately without a second round-trip.
    const enriched = { ...strategy, algorithmVersion: def.algorithmVersion };
    res.status(201).json(enriched);
  } catch (err) {
    logger.error("createStrategy error", { err });
    res.status(500).json({ error: "Failed to create strategy" });
  }
}

/** PUT /api/strategies/configs/:configId — body: { name, config, changeSummary? } */
export async function updateStrategyConfig(req: Request, res: Response): Promise<void> {
  const configId = String(req.params.configId);
  const { name, config, changeSummary } = req.body as {
    name: string;
    config: Record<string, unknown>;
    changeSummary?: string;
  };
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
    if (req.user!.role !== "lead" && existing.owner_id !== req.user!.id) {
      res.status(403).json({ error: "Only the strategy owner or a lead may edit this strategy" });
      return;
    }
    const version = await saveStrategyVersion({
      strategyId: configId,
      name,
      config,
      changeSummary: changeSummary?.trim() || "Updated strategy configuration",
      createdBy: req.user!.id,
    });
    res.json({ message: "Strategy updated", version });
  } catch (err) {
    logger.error("updateStrategyConfig error", { err });
    res.status(500).json({ error: "Failed to update strategy" });
  }
}

/** DELETE /api/strategies/configs/:configId */
export async function deleteStrategyConfig(req: Request, res: Response): Promise<void> {
  const configId = String(req.params.configId);
  try {
    const existing = await getStrategyById(configId);
    if (!existing) {
      res.status(404).json({ error: `Strategy ${configId} not found` });
      return;
    }
    if (req.user!.role !== "lead" && existing.owner_id !== req.user!.id) {
      res.status(403).json({ error: "Only the strategy owner or a lead may delete this strategy" });
      return;
    }
    // Only never-run, never-proposed drafts are deletable. The database would
    // refuse the rest anyway (runs reference the versions a delete cascades to).
    const history = await getStrategyHistoryCounts(configId);
    if (history.runs > 0 || history.proposals > 0) {
      res.status(409).json({
        error: "This strategy has run or review history and can't be deleted",
        detail:
          `It has ${history.runs} run(s) and ${history.proposals} proposal(s). Deleting would erase the ` +
          "record of what traded and how it was reviewed. Stop any active run and keep the strategy.",
        history,
      });
      return;
    }
    await deleteStrategy(configId);
    res.json({ message: "Strategy deleted" });
  } catch (err) {
    logger.error("deleteStrategyConfig error", { err });
    res.status(500).json({ error: "Failed to delete strategy" });
  }
}
