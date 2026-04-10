/**
 * hooks/useBacktest.ts
 *
 * Custom React hook for managing backtest runs and results.
 *
 * Inputs:  BacktestConfig for new runs; optional backtest ID to load.
 * Outputs: { results, selectedResult, isRunning, run, loadResult, error }
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchBacktests, fetchBacktest, runBacktest } from "../services/backtestService";
import type { BacktestConfig, BacktestResult } from "../types/api";

interface UseBacktestResult {
  results: BacktestResult[];
  selectedResult: BacktestResult | null;
  isLoading: boolean;
  isRunning: boolean;
  error: string | null;
  run: (config: Omit<BacktestConfig, "id">) => Promise<string>;
  loadResult: (id: string) => Promise<void>;
  refetch: () => void;
}

/**
 * Manages backtest result listing, triggering new runs, and loading detail views.
 * @returns UseBacktestResult
 */
export function useBacktest(): UseBacktestResult {
  const [results, setResults] = useState<BacktestResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<BacktestResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchBacktests();
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load backtest results");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const run = useCallback(async (config: Omit<BacktestConfig, "id">): Promise<string> => {
    setIsRunning(true);
    try {
      const { backtestId } = await runBacktest(config);
      await fetchData();
      return backtestId;
    } finally {
      setIsRunning(false);
    }
  }, [fetchData]);

  const loadResult = useCallback(async (id: string) => {
    const result = await fetchBacktest(id);
    setSelectedResult(result);
  }, []);

  return { results, selectedResult, isLoading, isRunning, error, run, loadResult, refetch: fetchData };
}
