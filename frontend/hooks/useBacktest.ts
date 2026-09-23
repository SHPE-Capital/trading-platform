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

/**
 * Where a submitted run is in the worker queue. "queued" for long usually means
 * no worker process is running (npm run dev:worker).
 */
export type QueueStatus = "queued" | "running";

interface UseBacktestResult {
  results: BacktestResult[];
  selectedResult: BacktestResult | null;
  previousResult: BacktestResult | null;
  isLoading: boolean;
  isRunning: boolean;
  isSaving: boolean;
  progress: BacktestProgress | null;
  queueStatus: QueueStatus | null;
  /** When the current run was queued (ms) — lets the page flag a stuck queue. */
  queuedAt: number | null;
  /** The last run reused an identical earlier result instead of simulating. */
  reused: boolean;
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
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [queuedAt, setQueuedAt] = useState<number | null>(null);
  const [reused, setReused] = useState(false);
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
    setQueueStatus(null);
    setQueuedAt(null);
    setReused(false);
    setError(null);
    const finish = () => {
      setIsRunning(false);
      setProgress(null);
      setQueueStatus(null);
      setQueuedAt(null);
    };
    try {
      const queued = await runBacktest(config, force);
      const { backtestId } = queued;

      // An identical run already finished — nothing to wait for.
      if (queued.status === "succeeded") {
        try {
          setSelectedResult(await fetchBacktest(backtestId));
          setReused(!!queued.reused);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to load result");
        } finally {
          finish();
        }
        return backtestId;
      }

      setQueueStatus(queued.status === "running" ? "running" : "queued");
      setQueuedAt(Date.now());

      // The run happens in a worker process; any API process relays its
      // progress from the job row. isRunning stays true until the stream ends.
      const es = new EventSource(`${appConfig.backtestApiBaseUrl}/backtests/${backtestId}/stream`);
      esRef.current = es;

      es.addEventListener("status", (e: MessageEvent) => {
        try {
          const { status } = JSON.parse(e.data as string) as { status: string };
          if (status === "queued" || status === "running") setQueueStatus(status);
        } catch {}
      });

      es.addEventListener("progress", (e: MessageEvent) => {
        const { barIndex, totalBars } = JSON.parse(e.data as string) as { barIndex: number; totalBars: number };
        setQueueStatus("running");
        // Cap at 99 — the bar reaches 100% only when the complete event fires.
        setProgress({ barIndex, totalBars, pct: Math.min(99, Math.round((barIndex / totalBars) * 100)) });
      });

      es.addEventListener("complete", (e: MessageEvent) => {
        es.close();
        esRef.current = null;
        let resultId = backtestId;
        try {
          const data = JSON.parse(e.data as string) as { backtestId?: string };
          if (data.backtestId) resultId = data.backtestId;
        } catch {}
        fetchBacktest(resultId)
          .then((result) => { setSelectedResult(result); return fetchData(); })
          .catch((err) => { setError(err instanceof Error ? err.message : "Failed to load result"); })
          .finally(finish);
      });

      es.addEventListener("error", (e: Event) => {
        // A named `error` event carries the job's failure. A bare connection
        // error while the job is live is the browser auto-reconnecting — let it.
        if (!(e instanceof MessageEvent) || !e.data) {
          if (es.readyState === EventSource.CLOSED) {
            esRef.current = null;
            setError("Lost the connection to the backtest stream");
            finish();
          }
          return;
        }
        es.close();
        esRef.current = null;
        let msg = "Backtest failed";
        try { msg = (JSON.parse(e.data as string) as { message: string }).message; } catch {}
        setError(msg);
        finish();
      });

      return backtestId;
    } catch (err) {
      finish();
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
    results, selectedResult, previousResult, isLoading, isRunning, isSaving, progress,
    queueStatus, queuedAt, reused, error, saveError,
    run, rerun, save, loadResult, refetch: fetchData,
  };
}
