/**
 * hooks/useStrategies.ts
 *
 * Custom React hook for fetching and managing strategy run state.
 *
 * Inputs:  Optional poll interval.
 * Outputs: { runs, isLoading, error, refetch, startStrategy, stopStrategy }
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchStrategyRuns, startPairsStrategy, stopStrategyRun } from "../services/strategiesService";
import type { StrategyRun, PairsStrategyConfig } from "../types/strategy";

interface UseStrategiesResult {
  runs: StrategyRun[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  startStrategy: (config: Omit<PairsStrategyConfig, "id">) => Promise<void>;
  stopStrategy: (id: string) => Promise<void>;
}

/**
 * Fetches strategy runs and provides start/stop actions.
 * @param pollIntervalMs - Poll interval in ms (0 = no polling)
 * @returns UseStrategiesResult
 */
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

  useEffect(() => {
    fetchData();
    if (pollIntervalMs <= 0) return;
    const interval = setInterval(fetchData, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchData, pollIntervalMs]);

  const startStrategy = useCallback(async (config: Omit<PairsStrategyConfig, "id">) => {
    await startPairsStrategy(config);
    await fetchData();
  }, [fetchData]);

  const stopStrategy = useCallback(async (id: string) => {
    await stopStrategyRun(id);
    await fetchData();
  }, [fetchData]);

  return { runs, isLoading, error, refetch: fetchData, startStrategy, stopStrategy };
}
