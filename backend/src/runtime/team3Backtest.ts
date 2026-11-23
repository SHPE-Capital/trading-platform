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
 *   TEAM3_STRATEGY         team3_reversal (default) | beginner_reversal (the A00 reference) | any catalog type
 *   TEAM3_DIAGNOSTIC       zero_cost: no slippage, spread or commission. Measures the GROSS edge.
 *                          Diagnostic only: never report it as an ablation row.
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
import { TEAM3_WINDOWS, protocolBacktestConfig } from "../strategies/team3Reversal/contract/protocol";
import { dailyPnl } from "../strategies/team3Reversal/contract/daily";
import { STRATEGY_DEFINITIONS, configProblem } from "../config/strategyDefaults";
import type { BaseStrategyConfig, StrategySignal } from "../types/strategy";
import { logger } from "../utils/logger";

const GROUPS: Record<string, string[]> = {
  core: ["SPY", "QQQ", "AAPL", "MSFT", "GOOGL", "AMZN"],
  momentum: ["SPY", "NVDA", "AMD", "MU", "TSLA", "META"],
};
const WINDOWS: Record<string, { startDate: string; endDate: string }> = TEAM3_WINDOWS;


async function main(): Promise<void> {
  const ownerId = process.env.BACKTEST_CLI_OWNER_ID;
  if (!ownerId) throw new Error("BACKTEST_CLI_OWNER_ID is required (your app_users.id)");
  // Empty values (e.g. `TEAM3_GROUP=` in .env) mean "use the default".
  const group = (process.env.TEAM3_GROUP?.trim() || "core").toLowerCase();
  const windowKey = (process.env.TEAM3_WINDOW?.trim() || "in").toLowerCase();
  if (!GROUPS[group]) throw new Error(`TEAM3_GROUP must be one of ${Object.keys(GROUPS).join(", ")}`);
  if (!WINDOWS[windowKey]) throw new Error(`TEAM3_WINDOW must be one of ${Object.keys(WINDOWS).join(", ")}`);
  const overrides = JSON.parse(process.env.TEAM3_CONFIG?.trim() || "{}") as Record<string, unknown>;

  const type = process.env.TEAM3_STRATEGY?.trim() || "team3_reversal";
  const definition = STRATEGY_DEFINITIONS[type];
  if (!definition) throw new Error(`unknown TEAM3_STRATEGY ${type}`);
  const diagnostic = process.env.TEAM3_DIAGNOSTIC?.trim() || "";
  if (diagnostic && diagnostic !== "zero_cost") throw new Error("TEAM3_DIAGNOSTIC must be zero_cost or empty");

  const strategyConfig = {
    ...definition.defaultConfig,
    ...overrides,
    symbols: GROUPS[group],
    type,
  } as unknown as BaseStrategyConfig;
  const problem = configProblem(type, strategyConfig as unknown as Record<string, unknown>);
  if (problem) throw new Error(`invalid config: ${problem}`);

  const config = protocolBacktestConfig(strategyConfig, WINDOWS[windowKey], definition.algorithmVersion);
  if (diagnostic === "zero_cost") config.fillModel = { slippageBps: 0, halfSpreadBps: 0, commissionPerShare: 0 };

  // Record every signal (meta included) so the row can report exit reasons and hold times.
  const signals: StrategySignal[] = [];
  const engine = new BacktestEngine(new BacktestLoader({ cache: new SupabaseBarCache() }), { tickSource: createTickSource });
  const result = await engine.run(config, () => buildBacktestStrategies(config).map((st) => {
    const evaluate = st.evaluate.bind(st);
    st.evaluate = (ctx) => { const sig = evaluate(ctx); if (sig) signals.push(sig); return sig; };
    return st;
  }));
  if (result.status !== "completed") throw new Error(`backtest ${result.status}: ${result.error_message ?? ""}`);


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

  // Daily P&L from the last equity point of each ET trading day (contract/daily.ts: the
  // engine's wall-clock final snapshot is folded into the last real day, not counted as a day).
  const daily = dailyPnl(curve, start, WINDOWS[windowKey]).map((d) => d.pnl);
  const mean = daily.reduce((a, b) => a + b, 0) / (daily.length || 1);
  const sd = Math.sqrt(daily.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(daily.length - 1, 1));
  const sharpeDaily = sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;

  let peak = start, maxDd = 0, maxDdPct = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.equity);
    if (peak - p.equity > maxDd) { maxDd = peak - p.equity; maxDdPct = maxDd / peak; }
  }

  // Team 3 only: exit-reason mix, hold times and signal-level gross bps (close vs real entry fill, before exit costs).
  const exits = signals.filter((x) => x.meta?.kind === "exit");
  const byReason: Record<string, { n: number; avgGrossBps: number; avgBars: number }> = {};
  for (const x of exits) {
    const r = String(x.meta?.reason);
    const b = (byReason[r] ??= { n: 0, avgGrossBps: 0, avgBars: 0 });
    b.n += 1;
    b.avgGrossBps += (Number(x.meta?.pnlBpsGross) - b.avgGrossBps) / b.n;
    b.avgBars += (Number(x.meta?.barsHeld) - b.avgBars) / b.n;
  }
  for (const b of Object.values(byReason)) { b.avgGrossBps = +b.avgGrossBps.toFixed(2); b.avgBars = +b.avgBars.toFixed(1); }
  // Per-symbol exit counts: lets two runs' identical totals be told apart (shared-output check).
  const exitsBySymbol: Record<string, Record<string, number>> = {};
  for (const x of exits) {
    const s = (exitsBySymbol[x.symbol] ??= {});
    const r = String(x.meta?.reason);
    s[r] = (s[r] ?? 0) + 1;
  }
  const targetBars = exits.filter((x) => x.meta?.reason === "target").map((x) => Number(x.meta?.barsHeld)).sort((a, b) => a - b);
  const entries = signals.filter((x) => x.meta?.kind === "enter");
  const entryZ = entries.map((x) => Math.abs(Number(x.meta?.vwapZ)));

  const row = {
    strategy: type, version: definition.algorithmVersion, diagnostic: diagnostic || null,
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
    exitReasons: exits.length ? byReason : null,
    exitsBySymbol: exits.length ? exitsBySymbol : null,
    medianTargetBars: targetBars.length ? targetBars[Math.floor(targetBars.length / 2)] : null,
    entriesPastStop: entries.length ? entryZ.filter((z) => z >= Number((strategyConfig as unknown as Record<string, unknown>).stopZ ?? Infinity)).length : null,
    medianEntryZ: entryZ.length ? +[...entryZ].sort((a, b) => a - b)[Math.floor(entryZ.length / 2)].toFixed(2) : null,
    backtestId: result.id,
    events: result.event_count,
  };
  console.log("TEAM3_ROW " + JSON.stringify(row));

  // Save after printing: the summary row (backtestId) must land; orders/fills are best effort,
  // because very active strategies (beginner_reversal) can exceed what one upload accepts.
  // The curve is stored slim (ts, isoTs, equity, cash, initialCapital): every reader only draws
  // ts/equity, and full snapshots (positions per point) hit the DB statement timeout on A00.
  // Same shape as slimEquityCurve on origin/JC (UPSTREAM.md #11).
  const slimCurve = curve.map((p) => ({
    ts: p.ts, isoTs: p.isoTs ?? new Date(p.ts).toISOString(), equity: p.equity, cash: p.cash, initialCapital: p.initialCapital,
  }));
  await insertBacktestResult({ ...result, equity_curve: slimCurve as unknown as typeof curve }, ownerId);
  try {
    await insertBacktestOrders(result.id, result.orders ?? []);
    await insertBacktestFills(result.id, result.fills ?? []);
  } catch (err) {
    logger.warn("runtime/team3Backtest: summary saved, but orders/fills were not", { id: result.id, err: String(err) });
  }
  logger.info("runtime/team3Backtest: saved", { id: result.id });
}

main().catch((err) => {
  logger.error("runtime/team3Backtest: fatal error", { err });
  process.exit(1);
});
