/**
 * runtime/backtest.ts
 *
 * Backtest runtime entry point. Runs a configured backtest from the CLI
 * without starting a live server. Results are persisted to the database.
 *
 * Usage: ts-node src/runtime/backtest.ts
 * Configure the strategy and date range below or pass via environment variables.
 *
 * Inputs:  Backtest configuration (hardcoded here; move to CLI args or env later).
 * Outputs: BacktestResult persisted to Supabase; summary printed to stdout.
 */

import { BacktestEngine } from "../core/backtest/backtestEngine";
import { PairsStrategy } from "../strategies/pairs/pairsStrategy";
import { createPairsConfig } from "../strategies/pairs/pairsConfig";
import { insertBacktestResult } from "../adapters/supabase/repositories";
import { logger } from "../utils/logger";
import { newId } from "../utils/ids";
import type { BacktestConfig } from "../types/backtest";

async function main(): Promise<void> {
  logger.info("runtime/backtest: starting");

  const pairsConfig = createPairsConfig("SPY", "QQQ");

  const config: BacktestConfig = {
    id: newId(),
    name: "SPY/QQQ Pairs Backtest",
    strategyConfig: pairsConfig as never,
    startDate: "2023-01-01T00:00:00Z",
    endDate: "2023-12-31T23:59:59Z",
    initialCapital: 100_000,
    dataGranularity: "bar",
    slippageBps: 5,
    commissionPerShare: 0.005,
    description: "Initial SPY/QQQ pairs backtest",
  };

  const engine = new BacktestEngine();
  const result = await engine.run(config, () => [new PairsStrategy(pairsConfig)]);

  logger.info("runtime/backtest: completed", {
    id: result.id,
    totalReturn: (result.metrics.totalReturnPct * 100).toFixed(2) + "%",
    maxDrawdown: (result.metrics.maxDrawdown * 100).toFixed(2) + "%",
    events: result.eventCount,
  });

  await insertBacktestResult(result);
  logger.info("runtime/backtest: result persisted", { id: result.id });
}

main().catch((err) => {
  logger.error("runtime/backtest: fatal error", { err });
  process.exit(1);
});
