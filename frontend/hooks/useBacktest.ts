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
import { fetchBacktests, fetchBacktest, runBacktest, saveBacktest } from "../services/backtestService";
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
  previousResult: BacktestResult | null;
  isLoading: boolean;
  isRunning: boolean;
  isSaving: boolean;
  progress: BacktestProgress | null;
  error: string | null;
  saveError: string | null;
  run: (config: Omit<BacktestConfig, "id">) => Promise<string>;
  rerun: (config: Omit<BacktestConfig, "id">) => Promise<string>;
  save: (id: string) => Promise<void>;
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
  const [previousResult, setPreviousResult] = useState<BacktestResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [progress, setProgress] = useState<BacktestProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
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

  const run = useCallback(async (config: Omit<BacktestConfig, "id">, force = false): Promise<string> => {
    setIsRunning(true);
    setProgress(null);
    setError(null);
    try {
      const { backtestId } = await runBacktest(config, force);
      await fetchData();

      // Open SSE stream for real-time progress. Must target the same process that
      // runs the job — backtestStreamManager is in-process, so a stream opened
      // against the trading runtime would never receive events from the API process.
      // isRunning stays true here — the SSE handlers below own the transition to false.
      const es = new EventSource(`${appConfig.backtestApiBaseUrl}/backtests/${backtestId}/stream`);
      esRef.current = es;

      es.addEventListener("progress", (e: MessageEvent) => {
        const { barIndex, totalBars } = JSON.parse(e.data as string) as { barIndex: number; totalBars: number };
        // Cap at 99 — the bar reaches 100% only when the complete event fires.
        setProgress({ barIndex, totalBars, pct: Math.min(99, Math.round((barIndex / totalBars) * 100)) });
      });

      es.addEventListener("complete", (e: MessageEvent) => {
        es.close();
        esRef.current = null;
        // For deduplicated runs the server sends { backtestId: <canonical DB id> }
        // which differs from the ephemeral config.id we started with. Using the
        // canonical id guarantees the fetch hits the DB even after the cache expires.
        let resultId = backtestId;
        try {
          const data = JSON.parse(e.data as string) as { backtestId?: string };
          if (data.backtestId) resultId = data.backtestId;
        } catch {}
        fetchBacktest(resultId)
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

  const save = useCallback(async (id: string): Promise<void> => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await saveBacktest(id);
      // Optimistic: mark the currently-displayed result saved without a round trip.
      // The real saved_at will show up next time this result is loaded from the list
      // (fetchData below refreshes it, since a saved result now appears there).
      setSelectedResult((prev) => (prev?.id === id ? { ...prev, saved_at: Date.now() } : prev));
      await fetchData();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save backtest");
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [fetchData]);

  // Stores the current result as "previous" then forces a fresh run (bypasses dedup).
  const selectedResultRef = useRef<BacktestResult | null>(null);
  selectedResultRef.current = selectedResult;
  const rerun = useCallback(async (config: Omit<BacktestConfig, "id">): Promise<string> => {
    setPreviousResult(selectedResultRef.current);
    setSelectedResult(null);
    return run(config, true);
  }, [run]);

  return {
    results, selectedResult, previousResult, isLoading, isRunning, isSaving, progress, error, saveError,
    run, rerun, save, loadResult, refetch: fetchData,
  };
}
