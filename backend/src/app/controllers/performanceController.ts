/**
 * app/controllers/performanceController.ts
 *
 * Live performance from the ledger: one run, or a strategy across every run of
 * it. Reports reuse the backtest metric names so the frontend renders both with
 * the same panel, and carry a buy-and-hold benchmark over the same window.
 * "Compare with backtest" queues a backtest of a run's exact window and config.
 */

import type { Request, Response } from "express";
import {
  backtestConfigKey,
  getFillsForRun,
  getRunsForStrategy,
  getStrategyById,
  getStrategyRunById,
  updateStrategyRun,
} from "../../adapters/supabase/repositories";
import { enqueueBacktestJob } from "../../adapters/supabase/backtestJobRepository";
import { SupabaseBarCache } from "../../adapters/supabase/barCacheRepository";
import { BacktestLoader } from "../../core/backtest/backtestLoader";
import { BACKTESTABLE_TYPES } from "../../core/backtest/strategyFactory";
import { benchmarkPnl, loadBenchmarkCurve } from "../../core/analytics/benchmark";
import { env } from "../../config/env";
import { newId } from "../../utils/ids";
import type { BacktestConfig } from "../../types/backtest";
import type { BaseStrategyConfig } from "../../types/strategy";
import type { PerformanceReport } from "../../types/analytics";
import {
  capitalBaseOf,
  filterStrategyRuns,
  getRunEvents,
  loadRunLedger,
  runSummariesFor,
  upsertRunStats,
} from "../../adapters/supabase/analyticsRepository";
import { getSupabaseClient } from "../../adapters/supabase/client";
import { buildRunReport, buildStrategyReport, computeRunStats } from "../../core/analytics/runPerformance";
import { sharedCache } from "../../utils/cache";
import { logger } from "../../utils/logger";
import type { AppContext } from "../context";

const REPORT_TTL_MS = 30_000;
const MARKS_TTL_MS = 15_000;
const BENCHMARK_TTL_MS = 3_600_000;

const benchmarkLoader = new BacktestLoader({ cache: new SupabaseBarCache() });

/** Benchmark closes over a window; empty when no bars are available (e.g. no data keys). */
async function benchmarkCurve(startMs: number, endMs: number): Promise<{ ts: number; value: number }[]> {
  const key = `bench:${env.benchmarkSymbol}:${Math.floor(startMs / 60_000)}:${Math.floor(endMs / 60_000)}`;
  return sharedCache.getOrLoad(key, BENCHMARK_TTL_MS, () =>
    loadBenchmarkCurve(benchmarkLoader, env.benchmarkSymbol, startMs, endMs).catch((err) => {
      logger.warn("performance: benchmark unavailable", { err: String(err) });
      return [];
    }));
}

function withBenchmark(report: PerformanceReport, curve: { ts: number; value: number }[]): PerformanceReport {
  return curve.length < 2 ? report : { ...report, benchmark: { symbol: env.benchmarkSymbol, curve: benchmarkPnl(curve, report.capitalBase) } };
}

/** Latest prices: the broker's position marks, then this process's live quotes. */
async function currentMarks(ctx: AppContext): Promise<Map<string, number>> {
  const marks = new Map<string, number>();
  if (ctx.broker) {
    try {
      const positions = await sharedCache.getOrLoad(`broker:positions:${ctx.broker.accountId}`, MARKS_TTL_MS, () => ctx.broker!.getPositions());
      for (const p of positions) marks.set(p.symbol, p.currentPrice);
    } catch (err) {
      logger.warn("performance: broker marks unavailable", { err: String(err) });
    }
  }
  for (const symbol of ctx.symbolState?.getSymbols() ?? []) {
    const s = ctx.symbolState!.get(symbol);
    const price = s?.latestMid ?? s?.latestBar?.close;
    if (price) marks.set(symbol, price);
  }
  return marks;
}

/** GET /api/runs/:runId/performance */
export async function getRunPerformance(req: Request, res: Response): Promise<void> {
  const runId = String(req.params.runId);
  const ctx = (req.app.locals.ctx ?? {}) as AppContext;
  try {
    const report = await sharedCache.getOrLoad(`perf:run:${runId}`, REPORT_TTL_MS, async () => {
      const run = await getStrategyRunById(runId);
      if (!run) return null;
      const [ledger, marks, events] = await Promise.all([loadRunLedger(run), currentMarks(ctx), getRunEvents(runId)]);
      const now = Date.now();
      // Keep the stored stats (run cards) in step with what this report shows.
      upsertRunStats([computeRunStats(ledger, marks, now)]).catch((err) =>
        logger.warn("performance: run stats not stored", { runId, err: String(err) }));
      const start = ledger.startedAt ?? ledger.fills[0]?.ts ?? now;
      const end = run.status === "running" ? now : (ledger.stoppedAt ?? ledger.fills[ledger.fills.length - 1]?.ts ?? now);
      const bench = await benchmarkCurve(start, end);
      return { ...withBenchmark(buildRunReport(ledger, { marks, now, benchmarkCurve: bench }), bench), events };
    });
    if (!report) {
      res.status(404).json({ error: `Run ${runId} not found` });
      return;
    }
    res.json(report);
  } catch (err) {
    logger.error("getRunPerformance failed", { runId, err: String(err) });
    res.status(500).json({ error: "Failed to build run performance" });
  }
}

/** GET /api/strategies/:strategyId/performance?mode=paper&versionId=&sandbox=include|exclude|only */
export async function getStrategyPerformance(req: Request, res: Response): Promise<void> {
  const strategyId = String(req.params.strategyId);
  const mode = String(req.query["mode"] ?? "paper");
  const versionId = req.query["versionId"] ? String(req.query["versionId"]) : undefined;
  const sandboxParam = String(req.query["sandbox"] ?? "include");
  const sandbox = (["include", "exclude", "only"].includes(sandboxParam) ? sandboxParam : "include") as "include" | "exclude" | "only";
  const ctx = (req.app.locals.ctx ?? {}) as AppContext;
  try {
    const key = `perf:strategy:${strategyId}:${mode}:${versionId ?? "all"}:${sandbox}`;
    const report = await sharedCache.getOrLoad(key, REPORT_TTL_MS, async () => {
      const strategy = await getStrategyById(strategyId);
      if (!strategy) return null;
      const runs = filterStrategyRuns(await getRunsForStrategy(strategyId), { mode, versionId, sandbox });
      const [ledgers, marks, summaries] = await Promise.all([
        Promise.all(runs.map((r) => loadRunLedger(r))),
        currentMarks(ctx),
        runSummariesFor(runs),
      ]);
      const now = Date.now();
      const starts = ledgers.map((l) => l.startedAt ?? l.fills[0]?.ts).filter((t): t is number => t !== undefined);
      const bench = starts.length > 0 ? await benchmarkCurve(Math.min(...starts), now) : [];
      const built = buildStrategyReport(strategyId, strategy.name, strategy.strategy_type, ledgers, summaries, { marks, now, benchmarkCurve: bench });
      return withBenchmark(built, bench);
    });
    if (!report) {
      res.status(404).json({ error: `Strategy ${strategyId} not found` });
      return;
    }
    res.json(report);
  } catch (err) {
    logger.error("getStrategyPerformance failed", { strategyId, err: String(err) });
    res.status(500).json({ error: "Failed to build strategy performance" });
  }
}

/** GET /api/runs/:runId/fills */
export async function getRunFills(req: Request, res: Response): Promise<void> {
  const runId = String(req.params.runId);
  try {
    const run = await getStrategyRunById(runId);
    if (!run) {
      res.status(404).json({ error: `Run ${runId} not found` });
      return;
    }
    res.json(await getFillsForRun(run, run.executionMode !== "live"));
  } catch (err) {
    logger.error("getRunFills failed", { runId, err: String(err) });
    res.status(500).json({ error: "Failed to fetch run fills" });
  }
}

/** GET /api/runs/:runId/signals?limit=200 — newest first */
export async function getRunSignals(req: Request, res: Response): Promise<void> {
  const runId = String(req.params.runId);
  const limit = Math.min(1000, Math.max(1, parseInt(String(req.query["limit"] ?? "200"), 10) || 200));
  const { data, error } = await getSupabaseClient().from("signals")
    .select("id, ts, symbol, direction, outcome, outcome_reason")
    .eq("run_id", runId).order("ts", { ascending: false }).limit(limit);
  if (error) {
    logger.error("getRunSignals failed", { runId, err: error.message });
    res.status(500).json({ error: "Failed to fetch run signals" });
    return;
  }
  res.json((data ?? []).map((s) => ({
    id: s.id, ts: new Date(s.ts as string).getTime(), symbol: s.symbol, direction: s.direction,
    outcome: s.outcome, reason: s.outcome_reason,
  })));
}

/**
 * POST /api/runs/:runId/compare-backtest  { force?: boolean }
 *
 * Queues a backtest of the run's exact window and config, so its live curve
 * can be laid over what the strategy would have done in simulation. Separates
 * "the strategy is bad" from "execution is bad". Returns the backtest id the
 * frontend polls; reuses the previous comparison unless forced.
 */
export async function compareRunWithBacktest(req: Request, res: Response): Promise<void> {
  const runId = String(req.params.runId);
  const force = !!(req.body as { force?: boolean } | undefined)?.force;
  try {
    const run = await getStrategyRunById(runId);
    if (!run) {
      res.status(404).json({ error: `Run ${runId} not found` });
      return;
    }
    if (!BACKTESTABLE_TYPES.has(run.strategyType)) {
      res.status(400).json({ error: `Backtesting is not supported for ${run.strategyType} yet, so this run cannot be compared` });
      return;
    }
    if (!run.startedAt) {
      res.status(400).json({ error: "This run has no start time to replay" });
      return;
    }
    const meta = (run.meta ?? {}) as Record<string, unknown>;
    if (meta.compareBacktestId && !force) {
      res.json({ backtestId: meta.compareBacktestId, reused: true });
      return;
    }
    const config: BacktestConfig = {
      id: newId(),
      name: `${run.name} — backtest of run ${run.id.slice(0, 8)}`,
      strategyConfig: { ...(run.config as unknown as Record<string, unknown>), type: run.strategyType } as unknown as BaseStrategyConfig,
      startDate: new Date(run.startedAt).toISOString(),
      endDate: new Date(run.stoppedAt ?? Date.now()).toISOString(),
      initialCapital: capitalBaseOf(run),
      slippageBps: 5,
      commissionPerShare: 0.005,
      dataGranularity: "bar",
      strategyId: run.strategyId,
      strategyVersionId: run.versionId,
      strategyVersion: run.strategyVersion,
      sourceRunId: run.id,
      description: `Replays run ${run.id} over its live window for comparison`,
    };
    const queued = await enqueueBacktestJob({
      id: config.id, configKey: backtestConfigKey(config), config, requestedBy: req.user?.id ?? null,
    });
    await updateStrategyRun(run.id, { meta: { ...meta, compareBacktestId: queued.jobId } });
    res.status(202).json({ backtestId: queued.jobId, deduped: queued.deduped });
  } catch (err) {
    logger.error("compareRunWithBacktest failed", { runId, err: String(err) });
    res.status(500).json({ error: "Failed to queue the comparison backtest" });
  }
}
