/**
 * hooks/usePerformance.ts
 *
 * Loads a run's or a strategy's performance report, refreshing on an interval
 * while a run is live.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchRunPerformance,
  fetchStrategyPerformance,
  type StrategyPerformanceFilter,
} from "../services/performanceService";
import type { PerformanceReport } from "../types/analytics";

interface UsePerformanceResult {
  report: PerformanceReport | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

function usePerformanceReport(load: (() => Promise<PerformanceReport>) | null, pollIntervalMs: number): UsePerformanceResult {
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!load) return;
    try {
      setError(null);
      setReport(await load());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load performance");
    } finally {
      setIsLoading(false);
    }
  }, [load]);

  useEffect(() => {
    queueMicrotask(() => void fetchData());
    if (pollIntervalMs <= 0) return;
    const interval = setInterval(fetchData, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchData, pollIntervalMs]);

  return { report, isLoading, error, refetch: fetchData };
}

export function useRunPerformance(runId: string | null, pollIntervalMs = 30_000): UsePerformanceResult {
  const load = useCallback(() => fetchRunPerformance(runId!), [runId]);
  return usePerformanceReport(runId ? load : null, pollIntervalMs);
}

export function useStrategyPerformance(
  strategyId: string | null,
  filter: StrategyPerformanceFilter,
  pollIntervalMs = 60_000,
): UsePerformanceResult {
  const { mode, versionId, sandbox } = filter;
  const load = useCallback(
    () => fetchStrategyPerformance(strategyId!, { mode, versionId, sandbox }),
    [strategyId, mode, versionId, sandbox],
  );
  return usePerformanceReport(strategyId ? load : null, pollIntervalMs);
}
