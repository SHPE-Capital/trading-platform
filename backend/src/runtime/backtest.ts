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
import { BacktestLoader } from "../core/backtest/backtestLoader";
import { SupabaseBarCache } from "../adapters/supabase/barCacheRepository";
import { createTickSource } from "../adapters/alpaca/historicalData";
import { buildBacktestStrategies } from "../core/backtest/strategyFactory";
import { STRATEGY_DEFINITIONS } from "../config/strategyDefaults";
import { insertBacktestResult, insertBacktestOrders, insertBacktestFills } from "../adapters/supabase/repositories";
import { logger } from "../utils/logger";
import { newId } from "../utils/ids";
import type { BacktestConfig } from "../types/backtest";

async function main(): Promise<void> {
  logger.info("runtime/backtest: starting");

  const type = process.env.BACKTEST_STRATEGY_TYPE ?? "pairs_trading";
  const definition = STRATEGY_DEFINITIONS[type];
  if (!definition) throw new Error(`Unknown strategy type: ${type}`);
  // JSON overrides let the same CLI exercise any registered strategy.
  const overrides = JSON.parse(process.env.BACKTEST_STRATEGY_CONFIG ?? "{}");
  const strategyConfig = { ...definition.defaultConfig, ...overrides, type } as BacktestConfig["strategyConfig"];

  const config: BacktestConfig = {
    id: newId(),
    name: `${definition.label} Backtest`,
    strategyConfig,
    strategyVersion: definition.algorithmVersion,
    startDate: process.env.BACKTEST_FROM ?? "2023-01-01T00:00:00Z",
    endDate: process.env.BACKTEST_TO ?? "2023-12-31T23:59:59Z",

    initialCapital: 100_000,
    dataGranularity: "bar",
    slippageBps: 5,
    commissionPerShare: 0.005,
    description: "Initial SPY/QQQ pairs backtest",
  };

  const engine = new BacktestEngine(new BacktestLoader({ cache: new SupabaseBarCache() }), { tickSource: createTickSource });
  const result = await engine.run(config, () => buildBacktestStrategies(config));

  logger.info("runtime/backtest: completed", {
    id: result.id,
    totalReturn: (result.metrics.totalReturnPct * 100).toFixed(2) + "%",
    maxDrawdown: (result.metrics.maxDrawdown * 100).toFixed(2) + "%",
    events: result.event_count,
  });

  // insertBacktestResult now requires the saving member's app_users.id (owner_id
  // has an FK to app_users) — there's no HTTP request/JWT here to derive one from,
  // so this CLI entry point takes it from an env var. Running this script at all is
  // already an explicit, deliberate action, unlike the app's UI flow it mirrors.
  const cliOwnerId = process.env.BACKTEST_CLI_OWNER_ID;
  if (!cliOwnerId) {
    throw new Error(
      "BACKTEST_CLI_OWNER_ID is required — set it to your app_users.id so this " +
        "result's owner_id FK resolves. Find your id via GET /api/auth/me.",
    );
  }

  await insertBacktestResult(result, cliOwnerId);
  logger.info("runtime/backtest: summary persisted", { id: result.id, event_count: result.event_count });

  await insertBacktestOrders(result.id, result.orders ?? []);
  logger.info("runtime/backtest: orders persisted", { count: result.orders?.length ?? 0 });

  await insertBacktestFills(result.id, result.fills ?? []);
  logger.info("runtime/backtest: fills persisted", { count: result.fills?.length ?? 0 });

  logger.info("runtime/backtest: result persisted", { id: result.id });
}

main().catch((err) => {
  logger.error("runtime/backtest: fatal error", { err });
  process.exit(1);
});
