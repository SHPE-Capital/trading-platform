/**
 * app/controllers/backtestController.ts
 *
 * Controller for backtest management endpoints — the control-plane half of the
 * durable queue (Part 02). This process never runs the engine: POST /run
 * enqueues a job that a worker process (runtime/backtestWorker.ts) executes,
 * and progress is relayed back from the job row. That is what makes it safe for
 * any process to accept a backtest request, trading runtimes included — the
 * simulated clock only ever exists inside a worker.
 *
 * A finished run is staged in backtest_job_artifacts for a save window; only an
 * explicit save writes it to backtest_results (0009).
 *
 * Inputs:  HTTP requests from the frontend backtest view.
 * Outputs: JSON backtest result data and SSE progress streams.
 */

import type { Request, Response } from "express";
import {
  getAllBacktestResults,
  getBacktestResultById,
  backtestResultExists,
  findMatchingBacktestResult,
  insertBacktestResult,
  insertBacktestOrders,
  insertBacktestFills,
  backtestConfigKey,
} from "../../adapters/supabase/repositories";
import {
  enqueueBacktestJob,
  findReusableJob,
  getBacktestJob,
  readJobSummary,
  readJobResultFull,
  deleteJobArtifacts,
} from "../../adapters/supabase/backtestJobRepository";
import { BacktestStreamManager } from "../../core/backtest/backtestStreamManager";
import { getStrategyVersionById } from "../../adapters/supabase/reviewRepositories";
import { PairsStrategy } from "../../strategies/pairs/pairsStrategy";
import { logger } from "../../utils/logger";
import { newId } from "../../utils/ids";
import type { BacktestConfig } from "../../types/backtest";

/** Strategy types a worker knows how to build (see core/backtest/strategyFactory.ts). */
const BACKTESTABLE_TYPES = new Set(["pairs_trading"]);

const streams = new BacktestStreamManager({
  getJob: (id) => getBacktestJob(id),
  savedResultExists: (id) => backtestResultExists(id),
});

/**
 * GET /api/backtests
 * Summaries of saved backtest results.
 */
export async function listBacktests(_req: Request, res: Response): Promise<void> {
  try {
    const results = await getAllBacktestResults();
    res.json(results);
  } catch (err) {
    logger.error("listBacktests error", { err });
    res.status(500).json({ error: "Failed to fetch backtest results" });
  }
}

/**
 * GET /api/backtests/:id
 * A saved result, or — for a run still inside its save window — the staged one
 * (carrying result_expires_at so the UI can say how long it stays saveable).
 */
export async function getBacktest(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  try {
    const saved = await getBacktestResultById(id);
    if (saved) { res.json(saved); return; }

    const staged = await readJobSummary(id);
    if (staged) { res.json(staged); return; }

    const job = await getBacktestJob(id);
    if (job && (job.status === "queued" || job.status === "running")) {
      res.status(202).json({ id, status: job.status, message: "Backtest has not finished yet" });
      return;
    }
    res.status(404).json({
      error: `Backtest ${id} not found`,
      detail: job?.status === "succeeded"
        ? "It finished but was never saved, and its save window has closed. Re-run it — cached bars make that fast."
        : undefined,
    });
  } catch (err) {
    logger.error("getBacktest error", { id, err });
    res.status(500).json({ error: "Failed to fetch backtest" });
  }
}

/**
 * POST /api/backtests/:id/save
 *
 * Persists a staged run to backtest_results / backtest_orders / backtest_fills,
 * then drops the staging copy. Idempotent: saving an already-saved id confirms
 * it rather than erroring.
 *
 * Known limitation: the three inserts are not one transaction (no cross-table
 * transaction over the REST client). If the result row writes and the orders
 * insert then throws, a retry reports alreadySaved rather than resuming.
 *
 * Requires requireAuth (mounted in backtestRoutes.ts) — req.user is populated.
 */
export async function saveBacktest(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);

  try {
    if (await backtestResultExists(id)) {
      res.json({ id, alreadySaved: true });
      return;
    }
  } catch (err) {
    logger.error("saveBacktest: existence check failed", { id, err });
    res.status(500).json({ error: "Failed to check whether this backtest is already saved" });
    return;
  }

  let full;
  try {
    full = await readJobResultFull(id);
  } catch (err) {
    logger.error("saveBacktest: staged result read failed", { id, err });
    res.status(500).json({ error: "Failed to load this backtest's result — try again" });
    return;
  }
  if (!full) {
    res.status(404).json({
      error: "This result is no longer available to save",
      detail:
        "Unsaved results stay saveable for 30 minutes after they finish. Re-run the backtest — " +
        "bars are cached, so a re-run of an unchanged config reproduces the same result quickly.",
    });
    return;
  }

  try {
    await insertBacktestResult(full, req.user!.id);
    // Orders must complete before fills: backtest_fills.order_id FK references backtest_orders.id
    await insertBacktestOrders(full.id, full.orders ?? []);
    await insertBacktestFills(full.id, full.fills ?? []);
  } catch (err) {
    // The staged copy is left in place so the member can retry without re-running.
    logger.error("saveBacktest: persist failed", { id, err });
    res.status(500).json({ error: "Failed to save backtest — try again" });
    return;
  }

  // backtest_results is canonical now; the staging copy is dead weight.
  await deleteJobArtifacts(id).catch((err) =>
    logger.warn("saveBacktest: saved, but staged copy not freed — the sweep will drop it", { id, err }),
  );
  logger.info("saveBacktest: saved", { id, savedBy: req.user!.id });
  res.status(201).json({ id, alreadySaved: false });
}

/**
 * GET /api/backtests/:id/stream
 * SSE: `status` (queued → running), `progress`, then `complete` or `error`.
 * Works for any job from any replica — progress comes from the job row.
 */
export async function streamBacktest(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  let cleanup: (() => void) | null;
  try {
    cleanup = await streams.subscribe(id, res);
  } catch (err) {
    logger.error("streamBacktest: could not read job", { id, err });
    if (!res.headersSent) res.status(500).json({ error: "Failed to open backtest stream" });
    else res.end();
    return;
  }
  if (!cleanup) {
    res.status(404).json({ error: `No backtest ${id}` });
    return;
  }
  res.on("close", cleanup);
}

/**
 * POST /api/backtests/run
 * Body: BacktestConfig (without id) plus optional `force` to skip result reuse.
 *
 * Reuses, in order: a saved result for the same config, then an unsaved one
 * still in its save window. Otherwise enqueues — joining an identical job
 * already queued or running on any replica instead of starting a second.
 *
 * Responds 200 when an existing result is returned, 202 when a job is queued.
 */
export async function runBacktest(req: Request, res: Response): Promise<void> {
  const { force, ...body } = req.body as Omit<BacktestConfig, "id"> & { force?: boolean };

  if (!body.strategyConfig || !body.startDate || !body.endDate) {
    res.status(400).json({ error: "strategyConfig, startDate, and endDate are required" });
    return;
  }
  if (!BACKTESTABLE_TYPES.has(body.strategyConfig.type)) {
    res.status(400).json({ error: `Backtesting is not supported for strategy type "${body.strategyConfig.type}"` });
    return;
  }
  if (body.strategyVersionId) {
    if (!body.strategyId) {
      res.status(400).json({ error: "strategyId is required when strategyVersionId is provided" });
      return;
    }
    const taggedVersion = await getStrategyVersionById(body.strategyVersionId);
    if (!taggedVersion || taggedVersion.strategyId !== body.strategyId) {
      res.status(400).json({
        error: "strategyVersionId does not belong to strategyId",
        detail: "Choose the saved strategy again before running the backtest.",
      });
      return;
    }
  }

  const rc = body.riskConfig;
  if (rc) {
    if (rc.maxIntradayDrawdownPct != null && (rc.maxIntradayDrawdownPct <= 0 || rc.maxIntradayDrawdownPct > 1)) {
      res.status(400).json({ error: "riskConfig.maxIntradayDrawdownPct must be between 0 (exclusive) and 1" });
      return;
    }
    if (rc.cashReservePct != null && (rc.cashReservePct < 0 || rc.cashReservePct >= 1)) {
      res.status(400).json({ error: "riskConfig.cashReservePct must be between 0 and 1 (exclusive)" });
      return;
    }
    if (rc.gapBufferBps != null && rc.gapBufferBps < 0) {
      res.status(400).json({ error: "riskConfig.gapBufferBps must be >= 0" });
      return;
    }
    if (rc.spreadBufferBps != null && rc.spreadBufferBps < 0) {
      res.status(400).json({ error: "riskConfig.spreadBufferBps must be >= 0" });
      return;
    }
  }

  // Resolve the algorithm version from the strategy class so the config key is
  // stable across requests regardless of what the frontend sends.
  const resolvedStrategyVersion: number | undefined =
    body.strategyConfig.type === "pairs_trading" ? PairsStrategy.VERSION : body.strategyVersion;

  const config: BacktestConfig = {
    ...body,
    id: newId(),
    initialCapital: body.initialCapital ?? 100_000,
    slippageBps: body.slippageBps ?? 5,
    commissionPerShare: body.commissionPerShare ?? 0.005,
    dataGranularity: body.dataGranularity ?? "bar",
    strategyVersion: resolvedStrategyVersion,
  };
  const configKey = backtestConfigKey(config);

  try {
    if (!force) {
      const saved = await findMatchingBacktestResult(config).catch((err) => {
        logger.warn("runBacktest: saved-result lookup failed — queueing a fresh run", { err: String(err) });
        return null;
      });
      if (saved) {
        res.json({ backtestId: saved.id, status: "succeeded", reused: true, message: "Reusing a saved identical run" });
        return;
      }
      const recent = await findReusableJob(configKey);
      if (recent) {
        res.json({ backtestId: recent.id, status: "succeeded", reused: true, message: "Reusing a recent identical run" });
        return;
      }
    }

    const queued = await enqueueBacktestJob({
      id: config.id,
      configKey,
      config,
      requestedBy: req.user?.id ?? null,
    });
    logger.info("runBacktest: enqueued", { jobId: queued.jobId, deduped: queued.deduped });
    res.status(202).json({
      backtestId: queued.jobId,
      status: queued.status,
      deduped: queued.deduped,
      message: queued.deduped ? "Joined an identical backtest already in progress" : "Backtest queued",
    });
  } catch (err) {
    logger.error("runBacktest: enqueue failed", { err });
    res.status(500).json({ error: "Failed to queue backtest" });
  }
}
