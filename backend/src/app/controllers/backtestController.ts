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
  insertBacktestResult,
  insertBacktestOrders,
  insertBacktestFills,
  updateBacktestResultStatus,
} from "../../adapters/supabase/repositories";
import { BacktestEngine } from "../../core/backtest/backtestEngine";
import { PairsStrategy } from "../../strategies/pairs/pairsStrategy";
import { createPairsConfig } from "../../strategies/pairs/pairsConfig";
import { logger } from "../../utils/logger";
import { newId } from "../../utils/ids";
import type { BacktestConfig } from "../../types/backtest";

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

  // Acknowledge the request immediately; backtest runs in background
  res.status(202).json({ backtestId: config.id, message: "Backtest queued" });

  // Run backtest asynchronously
  setImmediate(async () => {
    const engine = new BacktestEngine();
    let resultInserted = false;
    try {
      const result = await engine.run(config, () => {
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
      });
      await insertBacktestResult(result);
      resultInserted = true;
      await insertBacktestOrders(result.id, result.orders);
      await insertBacktestFills(result.id, result.fills);
      logger.info("Backtest completed and saved", { id: config.id });
    } catch (err) {
      logger.error("Backtest failed", { id: config.id, err });
      if (resultInserted) {
        try { await updateBacktestResultStatus(config.id, "failed"); } catch {}
      }
    }
  });
}
