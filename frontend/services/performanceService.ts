/**
 * services/performanceService.ts
 *
 * Live performance from the ledger: one run, or a saved strategy across all of
 * its runs, plus the raw rows behind the run page tables.
 */

import { apiGet } from "./api";
import type { PerformanceReport, RunSignal } from "../types/analytics";
import type { Fill } from "../types/portfolio";

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

export function fetchRunFills(runId: string): Promise<Fill[]> {
  return apiGet<Fill[]>(`/runs/${encodeURIComponent(runId)}/fills`);
}

export function fetchRunSignals(runId: string, limit = 200): Promise<RunSignal[]> {
  return apiGet<RunSignal[]>(`/runs/${encodeURIComponent(runId)}/signals?limit=${limit}`);
}
