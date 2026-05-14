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

interface CacheEntry {
  strategies: StoredStrategy[];
  definition: StrategyDefinition;
}

// Module-level cache shared across all hook instances for the session lifetime.
// Eliminates duplicate fetches when StrategyForm and BacktestForm both mount,
// and avoids re-fetching on every page navigation.
const _cache = new Map<StrategyType, CacheEntry>();
const _inFlight = new Map<StrategyType, Promise<CacheEntry>>();

export function useStrategyConfigs(type: StrategyType): UseStrategyConfigsResult {
  const cached = _cache.get(type);
  const [strategies, setStrategies] = useState<StoredStrategy[]>(cached?.strategies ?? []);
  const [definition, setDefinition] = useState<StrategyDefinition | null>(cached?.definition ?? null);
  const [isLoading, setIsLoading] = useState(cached === undefined);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const hit = _cache.get(type);
    if (hit) {
      setStrategies(hit.strategies);
      setDefinition(hit.definition);
      setIsLoading(false);
      return;
    }

    // Deduplicate concurrent requests for the same type — both callers await the
    // same promise so only one network round-trip fires.
    let promise = _inFlight.get(type);
    if (!promise) {
      promise = Promise.all([fetchStrategies(), fetchStrategyDefaults(type)])
        .then(([all, def]) => {
          const entry: CacheEntry = {
            strategies: all.filter((s) => s.strategy_type === type),
            definition: def,
          };
          _cache.set(type, entry);
          return entry;
        })
        .finally(() => { _inFlight.delete(type); });
      _inFlight.set(type, promise);
    }

    try {
      setError(null);
      const result = await promise;
      setStrategies(result.strategies);
      setDefinition(result.definition);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load strategy configs");
    } finally {
      setIsLoading(false);
    }
  }, [type]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const save = useCallback(async (name: string, config: Record<string, unknown>): Promise<StoredStrategy> => {
    const created = await createStrategyConfig({ strategy_type: type, name, config });
    _cache.delete(type);
    await fetchData();
    return created;
  }, [type, fetchData]);

  const update = useCallback(async (id: string, name: string, config: Record<string, unknown>): Promise<void> => {
    await updateStrategyConfig(id, name, config);
    _cache.delete(type);
    await fetchData();
  }, [type, fetchData]);

  const remove = useCallback(async (id: string): Promise<void> => {
    await deleteStrategyConfig(id);
    _cache.delete(type);
    await fetchData();
  }, [type, fetchData]);

  return { strategies, definition, isLoading, error, save, update, remove, refetch: fetchData };
}
