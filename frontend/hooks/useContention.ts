/**
 * hooks/useContention.ts
 *
 * Blocked-order counts per member and strategy over a window of days.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchContention, type ContentionRow } from "../services/governanceService";
import { useAuth } from "../context/AuthContext";

interface UseContentionResult {
  rows: ContentionRow[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useContention(days: number): UseContentionResult {
  const { user, isLoading: authLoading } = useAuth();
  const [rows, setRows] = useState<ContentionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setRows([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setRows((await fetchContention(days)).rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load contention");
    } finally {
      setIsLoading(false);
    }
  }, [days, user]);

  useEffect(() => {
    if (!authLoading) void load();
  }, [authLoading, load]);

  return { rows, isLoading: isLoading || authLoading, error, refetch: load };
}
