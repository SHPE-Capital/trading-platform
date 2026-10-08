/**
 * hooks/useStrategyVersions.ts
 *
 * Loads the config edit history for one saved strategy — every version, newest
 * first, with who made each edit. Backs the "version history" panel in
 * StrategyForm.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchVersions } from "../services/proposalsService";
import { useAuth } from "../context/AuthContext";
import type { StrategyVersion } from "../types/review";

interface UseStrategyVersionsResult {
  versions: StrategyVersion[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/** Pass null/undefined for a strategy that has not been saved yet ("new"). */
export function useStrategyVersions(strategyId: string | null | undefined): UseStrategyVersionsResult {
  const { user, isLoading: authLoading } = useAuth();
  const [versions, setVersions] = useState<StrategyVersion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !strategyId) {
      setVersions([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setVersions(await fetchVersions(strategyId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load version history");
    } finally {
      setIsLoading(false);
    }
  }, [strategyId, user]);

  useEffect(() => {
    if (!authLoading) void load();
  }, [authLoading, load]);

  return { versions, isLoading: isLoading || authLoading, error, refetch: load };
}
