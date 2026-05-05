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
  updateBacktestResultStatus,
} from "../../adapters/supabase/repositories";
import { BacktestEngine } from "../../core/backtest/backtestEngine";
import { PairsStrategy } from "../../strategies/pairs/pairsStrategy";
import { createPairsConfig } from "../../strategies/pairs/pairsConfig";
import { backtestStreamManager } from "../../core/backtest/backtestStreamManager";
import { logger } from "../../utils/logger";
import { newId } from "../../utils/ids";
import type { BacktestConfig, BacktestResult } from "../../types/backtest";

// In-memory cache so GET /api/backtests/:id is served instantly for a run that just
// completed, without a DB round trip. Entries expire after 10 minutes.
const CACHE_TTL_MS = 10 * 60 * 1000;
const resultCache = new Map<string, { result: BacktestResult; expiresAt: number }>();

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
  const body = req.body as Omit<BacktestConfig, "id">;

  if (!body.strategyConfig || !body.startDate || !body.endDate) {
    res.status(400).json({ error: "strategyConfig, startDate, and endDate are required" });
    return;
  }

  const config: BacktestConfig = {
    ...body,
    id: newId(),
    initialCapital: body.initialCapital ?? 100_000,
    slippageBps: body.slippageBps ?? 5,
    commissionPerShare: body.commissionPerShare ?? 0.005,
    dataGranularity: body.dataGranularity ?? "bar",
  };

  // Register the SSE channel before sending 202 to avoid a race where the
  // client subscribes before the channel exists
  backtestStreamManager.register(config.id);

  // Acknowledge the request immediately; backtest runs in background
  res.status(202).json({ backtestId: config.id, message: "Backtest queued" });

  // Run backtest asynchronously
  setImmediate(async () => {
    // Dedup: if an identical config has already been run, serve that result instead.
    const existing = await findMatchingBacktestResult(config);
    if (existing) {
      const reused = { ...existing, id: config.id, reused_from_id: existing.id };
      cacheResult(reused as typeof existing);
      backtestStreamManager.complete(config.id);
      logger.info("Backtest deduplicated", { id: config.id, reusedFromId: existing.id });
      return;
    }

    const engine = new BacktestEngine();
    let resultInserted = false;
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
      cacheResult(result);
      backtestStreamManager.complete(config.id);
      await insertBacktestResult(result);
      resultInserted = true;
      // Orders must complete before fills: backtest_fills.order_id FK references backtest_orders.id
      await insertBacktestOrders(result.id, result.orders);
      await insertBacktestFills(result.id, result.fills);
      logger.info("Backtest completed and saved", { id: config.id });
    } catch (err) {
      logger.error("Backtest failed", { id: config.id, err });
      backtestStreamManager.error(config.id, err instanceof Error ? err.message : "Backtest failed");
      if (resultInserted) {
        try { await updateBacktestResultStatus(config.id, "failed"); } catch {}
      }
    }
  });
}
