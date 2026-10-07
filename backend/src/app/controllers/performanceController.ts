/**
 * app/controllers/performanceController.ts
 *
 * Live performance from the ledger: one run, or a strategy across every run of
 * it. Reports reuse the backtest metric names so the frontend renders both with
 * the same panel.
 */

import type { Request, Response } from "express";
import { getFillsForRun, getRunsForStrategy, getStrategyRunById, getStrategyById } from "../../adapters/supabase/repositories";
import {
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
      return { ...buildRunReport(ledger, { marks, now }), events };
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
      return buildStrategyReport(strategyId, strategy.name, strategy.strategy_type, ledgers, summaries, { marks, now: Date.now() });
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
