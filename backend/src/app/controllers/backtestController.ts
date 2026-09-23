/**
 * app/controllers/backtestController.ts
 *
 * Controller for backtest management endpoints.
 * Handles triggering new backtests, listing past results, and retrieving
 * full result details including equity curve data for visualization.
 *
 * Inputs:  HTTP requests from the frontend backtest view.
 * Outputs: JSON backtest result data.
 */

import type { Request, Response } from "express";
import {
  getAllBacktestResults,
  getBacktestResultById,
  findMatchingBacktestResult,
  insertBacktestResult,
  insertBacktestOrders,
  insertBacktestFills,
  backtestConfigKey,
} from "../../adapters/supabase/repositories";
import { BacktestEngine } from "../../core/backtest/backtestEngine";
import { PairsStrategy } from "../../strategies/pairs/pairsStrategy";
import { createPairsConfig } from "../../strategies/pairs/pairsConfig";
import { backtestStreamManager } from "../../core/backtest/backtestStreamManager";
import { logger } from "../../utils/logger";
import { newId } from "../../utils/ids";
import type { BacktestConfig, BacktestResult } from "../../types/backtest";
import type { AppContext } from "../context";

// In-memory cache so GET /api/backtests/:id is served instantly for a run that just
// completed, without a DB round trip. Entries expire after 10 minutes.
const CACHE_TTL_MS = 10 * 60 * 1000;
const resultCache = new Map<string, { result: BacktestResult; expiresAt: number }>();

// Holds the FULL result (orders + fills included) for the window in which a member
// can still explicitly save it — this is the only place that data exists once a run
// completes, since it is no longer written to the DB automatically. Separate from
// resultCache (which intentionally strips orders/fills — see cacheResult below) so
// the two can carry different retention policies: the slim cache only needs to last
// long enough for the initial results view; this one needs to last long enough for
// someone to actually look at a run and decide whether it's worth keeping.
// Expiring is not data loss — a backtest is deterministic given cached bars, so
// "re-run to save" is always available as a fallback once this window closes.
const SAVE_WINDOW_MS = 30 * 60 * 1000;
const pendingSaveCache = new Map<string, { result: BacktestResult; expiresAt: number }>();

// Tracks config fingerprints of runs that are currently executing, mapped to
// the channel ID of the in-progress run. Used both to prevent duplicate engine
// runs and to relay progress events to duplicate SSE clients.
const inFlightKeys = new Map<string, string>(); // configKey → channelId

/**
 * Rejects a backtest request that arrived on a process running the trading engine.
 *
 * Trading runtimes mount this same REST API (see runtime/bootstrap.ts), so without
 * this guard a backtest started from the UI runs in-process: it installs a simulated
 * clock over the live one — corrupting quote timestamps, risk cooldowns, and
 * rolling-window eviction — and blocks the event loop that owns the broker WebSocket.
 *
 * @param req - Express Request; engine handles are read from app.locals.ctx
 * @param res - Express Response; receives 409 when the guard trips
 * @returns true when the request was rejected and the caller must stop
 */
function rejectIfTradingProcess(req: Request, res: Response): boolean {
  const { orchestrator, executionMode } = (req.app?.locals?.ctx ?? {}) as AppContext;
  if (!orchestrator) return false;

  res.status(409).json({
    error: "Backtests cannot run on a trading process",
    detail:
      `This server is running the ${executionMode ?? "live"} trading engine. ` +
      `Send backtest requests to the API-only process (port 8082) instead — ` +
      `set NEXT_PUBLIC_BACKTEST_API_BASE_URL to point there.`,
  });
  return true;
}

function cacheResult(result: BacktestResult): void {
  if (!result?.id) return;
  // Strip orders and fills before caching — they can be hundreds of thousands of
  // objects for long backtests. The DB row (backtest_results) omits them too, and
  // the frontend only needs metrics + equity_curve from the initial result load.
  const { orders: _o, fills: _f, ...slim } = result;
  resultCache.set(result.id, { result: slim as BacktestResult, expiresAt: Date.now() + CACHE_TTL_MS });
}

function getCached(id: string): BacktestResult | null {
  const entry = resultCache.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { resultCache.delete(id); return null; }
  return entry.result;
}

/** Stashes the full (unstripped) result so an explicit save can still find the
 *  orders/fills that cacheResult() deliberately dropped from the display cache. */
function stashForSave(result: BacktestResult): void {
  if (!result?.id) return;
  pendingSaveCache.set(result.id, { result, expiresAt: Date.now() + SAVE_WINDOW_MS });
}

/**
 * Reads without evicting — a save that fails partway through (e.g. the result row
 * writes but the orders insert then throws) must leave the entry in place so the
 * member can retry the save without needing to re-run the backtest.
 */
function peekPendingSave(id: string): BacktestResult | null {
  const entry = pendingSaveCache.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { pendingSaveCache.delete(id); return null; }
  return entry.result;
}

/**
 * GET /api/backtests
 * Returns summaries of all past backtest results.
 * @param req - Express Request
 * @param res - Express Response: BacktestResult[] JSON array (without equity_curve)
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
 * Returns the full result for a single backtest, including equity curve.
 * @param req - Express Request with params.id
 * @param res - Express Response: BacktestResult JSON or 404
 */
export async function getBacktest(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  try {
    const cached = getCached(id);
    if (cached) { res.json(cached); return; }

    const result = await getBacktestResultById(id);
    if (!result) {
      res.status(404).json({ error: `Backtest ${id} not found` });
      return;
    }
    res.json(result);
  } catch (err) {
    logger.error("getBacktest error", { id, err });
    res.status(500).json({ error: "Failed to fetch backtest" });
  }
}

/**
 * POST /api/backtests/:id/save
 *
 * Explicitly persists a completed run — the only path that writes to
 * backtest_results/backtest_orders/backtest_fills. Idempotent: saving an
 * already-saved id just confirms it, rather than erroring.
 *
 * Known limitation: the three inserts below are not transactional (the
 * Supabase JS client has no cross-table transaction here). If the result row
 * writes but insertBacktestOrders then throws, a retry sees the row already
 * exists and reports alreadySaved rather than resuming the orders/fills
 * insert. This mirrors the risk tolerance the original auto-persist code
 * already accepted (it logged a warning and moved on in the same situation);
 * closing it fully would need a Postgres function wrapping all three writes
 * in one transaction.
 *
 * Requires requireAuth (mounted in backtestRoutes.ts) — req.user is populated.
 *
 * @param req - Express Request with params.id; req.user from requireAuth
 * @param res - Express Response: { id, alreadySaved? } or an error
 */
export async function saveBacktest(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  try {
    const existing = await getBacktestResultById(id);
    if (existing) {
      res.json({ id, alreadySaved: true });
      return;
    }
  } catch (err) {
    logger.error("saveBacktest: existence check failed", { id, err });
    res.status(500).json({ error: "Failed to check whether this backtest is already saved" });
    return;
  }

  const full = peekPendingSave(id);
  if (!full) {
    res.status(404).json({
      error: "This result is no longer available to save",
      detail:
        "It either expired (results stay saveable for 30 minutes after completion) or the " +
        "server restarted. Re-run the backtest — the underlying bar data is cached, so a " +
        "re-run of an unchanged config reproduces the same result.",
    });
    return;
  }

  try {
    await insertBacktestResult(full, req.user!.id);
    // Orders must complete before fills: backtest_fills.order_id FK references backtest_orders.id
    await insertBacktestOrders(full.id, full.orders ?? []);
    await insertBacktestFills(full.id, full.fills ?? []);
  } catch (err) {
    logger.error("saveBacktest: persist failed", { id, err });
    // Deliberately do NOT evict from pendingSaveCache — leaving it in place lets
    // the member retry the save without needing to re-run the backtest.
    res.status(500).json({ error: "Failed to save backtest — try again" });
    return;
  }

  pendingSaveCache.delete(id);
  logger.info("saveBacktest: saved", { id, savedBy: req.user!.id });
  res.status(201).json({ id, alreadySaved: false });
}

/**
 * GET /api/backtests/:id/stream
 * SSE endpoint that streams live progress events for an in-progress backtest run.
 * Connects to the run's EventEmitter channel and forwards progress/complete/error
 * events as Server-Sent Events. Returns 404 if the run is not active.
 * @param req - Express Request with params.id
 * @param res - Express Response opened as text/event-stream
 */
export function streamBacktest(req: Request, res: Response): void {
  const id = req.params.id as string;
  const cleanup = backtestStreamManager.subscribe(id, res);
  if (!cleanup) {
    res.status(404).json({ error: `No active stream for backtest ${id}` });
    return;
  }
  req.on("close", cleanup);
}

/**
 * POST /api/backtests/run
 * Triggers a new backtest run. Runs asynchronously and persists results.
 * Body: BacktestConfig (without id — assigned server-side)
 * @param req - Express Request with BacktestConfig in body
 * @param res - Express Response: { backtestId: string, message: string }
 */
export async function runBacktest(req: Request, res: Response): Promise<void> {
  if (rejectIfTradingProcess(req, res)) return;

  const { force, ...body } = req.body as Omit<BacktestConfig, "id"> & { force?: boolean };

  if (!body.strategyConfig || !body.startDate || !body.endDate) {
    res.status(400).json({ error: "strategyConfig, startDate, and endDate are required" });
    return;
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

  // Resolve the strategy version from the actual strategy class so the config
  // key is stable across requests regardless of what the frontend sends.
  // Adding a new strategy type here is the only change needed when extending.
  const resolvedStrategyVersion: number | undefined =
    body.strategyConfig?.type === "pairs_trading" ? PairsStrategy.VERSION : body.strategyVersion;

  const config: BacktestConfig = {
    ...body,
    id: newId(),
    initialCapital: body.initialCapital ?? 100_000,
    slippageBps: body.slippageBps ?? 5,
    commissionPerShare: body.commissionPerShare ?? 0.005,
    dataGranularity: body.dataGranularity ?? "bar",
    strategyVersion: resolvedStrategyVersion,
  };

  // Register the SSE channel before sending 202 to avoid a race where the
  // client subscribes before the channel exists
  backtestStreamManager.register(config.id);

  // Acknowledge the request immediately; backtest runs in background
  res.status(202).json({ backtestId: config.id, message: "Backtest queued" });

  // Run backtest asynchronously. The outer try/catch ensures any unexpected
  // rejection (including DB connectivity failures in the dedup check) always
  // resolves the SSE channel so the client does not hang indefinitely.
  const configKey = backtestConfigKey(config);

  setImmediate(async () => {
    // Guard against concurrent identical requests both slipping through the DB
    // dedup check (which only sees completed runs). The second request signals
    // completion immediately so its SSE client is not left hanging.
    if (!force && inFlightKeys.has(configKey)) {
      const existingChannelId = inFlightKeys.get(configKey)!;
      logger.info("Backtest deduplicated (in-flight)", { id: config.id, existingChannelId, configKey });
      backtestStreamManager.relay(config.id, existingChannelId);
      return;
    }

    inFlightKeys.set(configKey, config.id);
    try {
      // Dedup: if an identical config has already been run, serve that result instead.
      // Skipped when force=true (explicit re-run requested by the user).
      // If the DB is unreachable, log a warning and proceed as a fresh run.
      let existing = null;
      if (!force) {
        logger.info("Backtest dedup: searching DB for matching result", { id: config.id, configKey });
        try {
          existing = await findMatchingBacktestResult(config);
          logger.info("Backtest dedup: DB search complete", {
            id: config.id,
            found: !!existing,
            existingId: existing?.id ?? null,
          });
        } catch (dbErr) {
          logger.error("Backtest dedup: DB search failed — running fresh backtest", { id: config.id, err: dbErr });
        }
      } else {
        logger.info("Backtest dedup: skipping DB search (force=true)", { id: config.id });
      }

      if (existing) {
        logger.info("Backtest dedup: returning existing result, engine will NOT run", {
          id: config.id,
          existingId: existing.id,
        });
        const reused = { ...existing, id: config.id, reused_from_id: existing.id };
        cacheResult(reused as typeof existing);
        // Release the in-flight key before firing complete so any subsequent
        // request with the same config immediately goes through the DB dedup
        // path rather than hitting the relay branch on an already-closed channel.
        inFlightKeys.delete(configKey);
        backtestStreamManager.complete(config.id, { backtestId: existing.id });
        logger.info("Backtest dedup: SSE complete fired with existing result", { id: config.id, backtestId: existing.id });
        return;
      }

      logger.info("Backtest dedup: no match found, starting engine run", { id: config.id });
      const engine = new BacktestEngine();
      try {
        const result = await engine.run(
          config,
          () => {
            // Factory creates the strategy specified in the config
            if (config.strategyConfig.type === "pairs_trading") {
              const pairsConfig = createPairsConfig(
                config.strategyConfig.symbols[0],
                config.strategyConfig.symbols[1] ?? config.strategyConfig.symbols[0],
                config.strategyConfig as never,
              );
              return [new PairsStrategy(pairsConfig)];
            }
            return [];
          },
          (point) => backtestStreamManager.emit(config.id, point),
        );
        logger.info("Backtest engine run finished", { id: config.id });
        cacheResult(result);
        // The full result — orders and fills included — is only ever held here.
        // Nothing is written to the DB until a member explicitly saves it via
        // POST /:id/save; see the module doc comment on pendingSaveCache above.
        stashForSave(result);
        // Release in-flight key before SSE fires so back-to-back runs from the
        // same client reach findMatchingBacktestResult instead of the relay path.
        inFlightKeys.delete(configKey);
        backtestStreamManager.complete(config.id, { backtestId: config.id });
        logger.info("Backtest SSE complete fired for fresh run", { id: config.id });
      } catch (err) {
        logger.error("Backtest engine failed", { id: config.id, err });
        backtestStreamManager.error(config.id, err instanceof Error ? err.message : "Backtest failed");
      }
    } catch (err) {
      // Catch-all: guarantees the SSE channel is always resolved
      logger.error("Backtest runner unexpected error", { id: config.id, err });
      backtestStreamManager.error(config.id, err instanceof Error ? err.message : "Backtest failed");
    } finally {
      inFlightKeys.delete(configKey);
    }
  });
}
