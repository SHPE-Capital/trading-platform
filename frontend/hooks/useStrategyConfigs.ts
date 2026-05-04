/**
 * hooks/useStrategyConfigs.ts
 *
 * Hook for managing saved strategy configs and type defaults.
 * Kept separate from useStrategies intentionally: useStrategies polls
 * every 15 s for live run-status updates, whereas configs are static once
 * created. The backtest page also needs configs but never needs runs.
 *
 * Inputs:  StrategyType to filter by (e.g. "pairs_trading")
 * Outputs: { strategies, definition, isLoading, error, save, update, remove, refetch }
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchStrategies,
  fetchStrategyDefaults,
  createStrategyConfig,
  updateStrategyConfig,
  deleteStrategyConfig,
} from "../services/strategiesService";
import type { StoredStrategy, StrategyDefinition, StrategyType } from "../types/strategy";

interface UseStrategyConfigsResult {
  strategies: StoredStrategy[];
  definition: StrategyDefinition | null;
  isLoading: boolean;
  error: string | null;
  save: (name: string, config: Record<string, unknown>) => Promise<StoredStrategy>;
  update: (id: string, name: string, config: Record<string, unknown>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refetch: () => void;
}

export function useStrategyConfigs(type: StrategyType): UseStrategyConfigsResult {
  const [strategies, setStrategies] = useState<StoredStrategy[]>([]);
  const [definition, setDefinition] = useState<StrategyDefinition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [all, def] = await Promise.all([fetchStrategies(), fetchStrategyDefaults(type)]);
      setStrategies(all.filter((s) => s.strategy_type === type));
      setDefinition(def);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load strategy configs");
    } finally {
      setIsLoading(false);
    }
  }, [type]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const save = useCallback(async (name: string, config: Record<string, unknown>): Promise<StoredStrategy> => {
    const created = await createStrategyConfig({ strategy_type: type, name, config });
    await fetchData();
    return created;
  }, [type, fetchData]);

  const update = useCallback(async (id: string, name: string, config: Record<string, unknown>): Promise<void> => {
    await updateStrategyConfig(id, name, config);
    await fetchData();
  }, [fetchData]);

  const remove = useCallback(async (id: string): Promise<void> => {
    await deleteStrategyConfig(id);
    await fetchData();
  }, [fetchData]);

  return { strategies, definition, isLoading, error, save, update, remove, refetch: fetchData };
}
