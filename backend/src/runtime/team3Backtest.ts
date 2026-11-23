/**
 * runtime/team3Backtest.ts
 *
 * Runs one Team 3 ablation backtest under TEAM3_PROTOCOL (contract/protocol.ts),
 * saves it like runtime/backtest.ts does, and prints every column
 * docs/team3/ablation.md requires.
 *
 *   npx ts-node src/runtime/team3Backtest.ts
 *
 * Env:
 *   BACKTEST_CLI_OWNER_ID  required, your app_users.id (result owner)
 *   TEAM3_GROUP            core (default) | momentum   (AGENT_GUIDE.md §2)
 *   TEAM3_WINDOW           in (default) | out          (ablation.md header)
 *   TEAM3_CONFIG           JSON overrides vs the strategy defaults, e.g. {"useVwapRegime":true}
 *
 * Why not runtime/backtest.ts: it passes no riskConfig, so the platform default
 * applies (drawdown stop at -$5,000, .env caps), which the protocol forbids.
 */

import { BacktestEngine } from "../core/backtest/backtestEngine";
import { BacktestLoader } from "../core/backtest/backtestLoader";
import { SupabaseBarCache } from "../adapters/supabase/barCacheRepository";
import { createTickSource } from "../adapters/alpaca/historicalData";
import { buildBacktestStrategies } from "../core/backtest/strategyFactory";
import { insertBacktestResult, insertBacktestOrders, insertBacktestFills } from "../adapters/supabase/repositories";
import { protocolBacktestConfig } from "../strategies/team3Reversal/contract/protocol";
import { team3ReversalManifest } from "../strategies/team3Reversal/manifest";
import { Team3ReversalStrategy } from "../strategies/team3Reversal/team3ReversalStrategy";
import type { BaseStrategyConfig } from "../types/strategy";
import { logger } from "../utils/logger";

const GROUPS: Record<string, string[]> = {
  core: ["SPY", "QQQ", "AAPL", "MSFT", "GOOGL", "AMZN"],
  momentum: ["SPY", "NVDA", "AMD", "MU", "TSLA", "META"],
};
const WINDOWS: Record<string, { startDate: string; endDate: string }> = {
  in: { startDate: "2026-09-01T00:00:00Z", endDate: "2026-10-15T23:59:59Z" },
  out: { startDate: "2026-10-16T00:00:00Z", endDate: "2026-11-13T23:59:59Z" },
};

const ET_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

async function main(): Promise<void> {
  const ownerId = process.env.BACKTEST_CLI_OWNER_ID;
  if (!ownerId) throw new Error("BACKTEST_CLI_OWNER_ID is required (your app_users.id)");
  // Empty values (e.g. `TEAM3_GROUP=` in .env) mean "use the default".
  const group = (process.env.TEAM3_GROUP?.trim() || "core").toLowerCase();
  const windowKey = (process.env.TEAM3_WINDOW?.trim() || "in").toLowerCase();
  if (!GROUPS[group]) throw new Error(`TEAM3_GROUP must be one of ${Object.keys(GROUPS).join(", ")}`);
  if (!WINDOWS[windowKey]) throw new Error(`TEAM3_WINDOW must be one of ${Object.keys(WINDOWS).join(", ")}`);
  const overrides = JSON.parse(process.env.TEAM3_CONFIG?.trim() || "{}") as Record<string, unknown>;

  const strategyConfig = {
    ...team3ReversalManifest.defaultConfig,
    ...overrides,
    symbols: GROUPS[group],
    type: team3ReversalManifest.type,
  } as unknown as BaseStrategyConfig;
  const problem = team3ReversalManifest.validate?.(strategyConfig as unknown as Record<string, unknown>);
  if (problem) throw new Error(`invalid config: ${problem}`);

  const config = protocolBacktestConfig(strategyConfig, WINDOWS[windowKey], Team3ReversalStrategy.VERSION);
  const engine = new BacktestEngine(new BacktestLoader({ cache: new SupabaseBarCache() }), { tickSource: createTickSource });
  const result = await engine.run(config, () => buildBacktestStrategies(config));
  if (result.status !== "completed") throw new Error(`backtest ${result.status}: ${result.error_message ?? ""}`);

  await insertBacktestResult(result, ownerId);
  await insertBacktestOrders(result.id, result.orders ?? []);
  await insertBacktestFills(result.id, result.fills ?? []);

  // ---- ablation columns -------------------------------------------------
  const m = result.metrics;
  const curve = result.equity_curve ?? [];
  const start = config.initialCapital;
  const end = curve.length ? curve[curve.length - 1].equity : start;
  const netPnl = end - start;

  // Traded notional: entry side of each round trip = half of all fill notional.
  const fills = result.fills ?? [];
  const tradedNotional = fills.reduce((s, f) => s + Math.abs(f.notional), 0) / 2;
  const costs = fills.reduce((s, f) => s + (f.commission ?? 0), 0);

  // Daily P&L from the last equity point of each ET trading day.
  const lastByDay = new Map<string, number>();
  for (const p of curve) lastByDay.set(ET_DAY.format(new Date(p.ts)), p.equity);
  const dayEquity = [start, ...lastByDay.values()];
  const daily = dayEquity.slice(1).map((e, i) => e - dayEquity[i]);
  const mean = daily.reduce((a, b) => a + b, 0) / (daily.length || 1);
  const sd = Math.sqrt(daily.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(daily.length - 1, 1));
  const sharpeDaily = sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;

  let peak = start, maxDd = 0, maxDdPct = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.equity);
    if (peak - p.equity > maxDd) { maxDd = peak - p.equity; maxDdPct = maxDd / peak; }
  }

  const row = {
    version: Team3ReversalStrategy.VERSION,
    group, window: windowKey, config: overrides,
    netPnl: +netPnl.toFixed(2),
    trades: m.totalTrades,
    avgBpsPerTrade: tradedNotional > 0 ? +((netPnl / tradedNotional) * 1e4).toFixed(2) : null,
    winRatePct: +(m.winRate * 100).toFixed(1),
    payoff: m.avgLoss ? +(m.avgWin / Math.abs(m.avgLoss)).toFixed(2) : null,
    profitFactor: m.profitFactor != null ? +m.profitFactor.toFixed(2) : null,
    sharpeDaily: +sharpeDaily.toFixed(2),
    maxDdUsd: +maxDd.toFixed(2),
    maxDdPct: +(maxDdPct * 100).toFixed(2),
    commissions: +costs.toFixed(2),
    tradingDays: daily.length,
    worstDay: daily.length ? +Math.min(...daily).toFixed(2) : null,
    pctDaysProfitable: daily.length ? +((daily.filter((d) => d > 0).length / daily.length) * 100).toFixed(1) : null,
    engineSharpe: m.sharpeRatio ?? null,
    backtestId: result.id,
    events: result.event_count,
  };
  console.log("TEAM3_ROW " + JSON.stringify(row));
  logger.info("runtime/team3Backtest: saved", { id: result.id });
}

main().catch((err) => {
  logger.error("runtime/team3Backtest: fatal error", { err });
  process.exit(1);
});
