/**
 * hooks/useStrategies.ts
 *
 * Custom React hook for fetching and managing strategy run state.
 */

"use client";

import { useState, useCallback } from "react";
import { usePolling } from "./usePolling";
import { fetchStrategyRuns, startPaperStrategy, stopStrategyRun } from "../services/strategiesService";
import type { StrategyRun } from "../types/strategy";

interface UseStrategiesResult {
  runs: StrategyRun[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  startStrategy: (selection: { strategyId: string; versionId: string }) => Promise<void>;
  stopStrategy: (id: string) => Promise<void>;
}

export function useStrategies(pollIntervalMs = 15_000): UseStrategiesResult {
  const [runs, setRuns] = useState<StrategyRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchStrategyRuns();
      setRuns(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load strategies");
    } finally {
      setIsLoading(false);
    }
  }, []);

  usePolling(fetchData, pollIntervalMs);

  const startStrategy = useCallback(async (selection: { strategyId: string; versionId: string }) => {
    await startPaperStrategy(selection.strategyId, selection.versionId);
    await fetchData();
  }, [fetchData]);

  const stopStrategy = useCallback(async (id: string) => {
    try {
      await stopStrategyRun(id);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop strategy");
    }
  }, [fetchData]);

  return { runs, isLoading, error, refetch: fetchData, startStrategy, stopStrategy };
}
