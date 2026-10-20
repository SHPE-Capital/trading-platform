/**
 * services/performanceService.ts
 *
 * Live performance from the ledger: one run, or a saved strategy across all of
 * its runs, plus the raw rows behind the run page tables.
 */

import { apiGet, apiPost } from "./api";
import { queryRunFills, queryRunSignals } from "./db";
import type { PerformanceReport, RunSignal } from "../types/analytics";
import type { Fill } from "../types/portfolio";
import type { ExecutionSettings } from "../types/api";

export interface StrategyPerformanceFilter {
  mode?: "paper" | "live";
  versionId?: string;
  sandbox?: "include" | "exclude" | "only";
}

export function fetchRunPerformance(runId: string): Promise<PerformanceReport> {
  return apiGet<PerformanceReport>(`/runs/${encodeURIComponent(runId)}/performance`);
}

export function fetchStrategyPerformance(strategyId: string, filter: StrategyPerformanceFilter = {}): Promise<PerformanceReport> {
  const qs = new URLSearchParams();
  if (filter.mode) qs.set("mode", filter.mode);
  if (filter.versionId) qs.set("versionId", filter.versionId);
  if (filter.sandbox) qs.set("sandbox", filter.sandbox);
  const q = qs.toString();
  return apiGet<PerformanceReport>(`/strategies/${encodeURIComponent(strategyId)}/performance${q ? `?${q}` : ""}`);
}

/**
 * Queues a backtest of the run's exact window and config; returns the backtest
 * to poll. With `execution`, it prices fills that way (the run keeps one
 * comparison per fill model).
 */
export function compareRunWithBacktest(
  runId: string,
  force = false,
  execution?: ExecutionSettings,
): Promise<{ backtestId: string; reused?: boolean }> {
  return apiPost<{ backtestId: string; reused?: boolean }>(
    `/runs/${encodeURIComponent(runId)}/compare-backtest`,
    execution ? { force, execution } : { force },
  );
}

export function fetchRunFills(runId: string): Promise<Fill[]> {
  return queryRunFills(runId);
}

export function fetchRunSignals(runId: string, limit = 200): Promise<RunSignal[]> {
  return queryRunSignals(runId, limit);
}
