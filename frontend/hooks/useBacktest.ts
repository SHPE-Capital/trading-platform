/**
 * hooks/useBacktest.ts
 *
 * Custom React hook for managing backtest runs and results.
 *
 * Inputs:  BacktestConfig for new runs; optional backtest ID to load.
 * Outputs: { results, selectedResult, isRunning, progress, run, loadResult, error }
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchBacktests, fetchBacktest, runBacktest } from "../services/backtestService";
import { config as appConfig } from "../config";
import type { BacktestConfig, BacktestResult } from "../types/api";

interface BacktestProgress {
  barIndex: number;
  totalBars: number;
  pct: number;
}

interface UseBacktestResult {
  results: BacktestResult[];
  selectedResult: BacktestResult | null;
  isLoading: boolean;
  isRunning: boolean;
  progress: BacktestProgress | null;
  error: string | null;
  run: (config: Omit<BacktestConfig, "id">) => Promise<string>;
  loadResult: (id: string, prefetched?: BacktestResult) => Promise<void>;
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
  const [progress, setProgress] = useState<BacktestProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

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

  // Close any open SSE connection when the component unmounts
  useEffect(() => () => { esRef.current?.close(); }, []);

  const run = useCallback(async (config: Omit<BacktestConfig, "id">): Promise<string> => {
    setIsRunning(true);
    setProgress(null);
    setError(null);
    try {
      const { backtestId } = await runBacktest(config);
      await fetchData();

      // Open SSE stream for real-time progress.
      // appConfig.apiBaseUrl (e.g. http://localhost:8080/api) + path = full endpoint URL.
      // isRunning stays true here — the SSE handlers below own the transition to false.
      const es = new EventSource(`${appConfig.apiBaseUrl}/backtests/${backtestId}/stream`);
      esRef.current = es;

      es.addEventListener("progress", (e: MessageEvent) => {
        const { barIndex, totalBars } = JSON.parse(e.data as string) as { barIndex: number; totalBars: number };
        setProgress({ barIndex, totalBars, pct: Math.round((barIndex / totalBars) * 100) });
      });

      es.addEventListener("complete", () => {
        es.close();
        esRef.current = null;
        // Result is in the backend in-memory cache — single fetch, no polling needed
        fetchBacktest(backtestId)
          .then((result) => { setSelectedResult(result); return fetchData(); })
          .catch((err) => { setError(err instanceof Error ? err.message : "Failed to load result"); })
          .finally(() => { setIsRunning(false); setProgress(null); });
      });

      es.addEventListener("error", (e: Event) => {
        es.close();
        esRef.current = null;
        let msg = "Backtest failed";
        if (e instanceof MessageEvent && e.data) {
          try { msg = (JSON.parse(e.data as string) as { message: string }).message; } catch {}
        }
        setError(msg);
        setIsRunning(false);
        setProgress(null);
      });

      return backtestId;
    } catch (err) {
      setIsRunning(false);
      setProgress(null);
      throw err;
    }
  }, [fetchData]);

  const loadResult = useCallback(async (id: string, prefetched?: BacktestResult) => {
    const result = prefetched ?? await fetchBacktest(id);
    setSelectedResult(result);
  }, []);

  return { results, selectedResult, isLoading, isRunning, progress, error, run, loadResult, refetch: fetchData };
}
