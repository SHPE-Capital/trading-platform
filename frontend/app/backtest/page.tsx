/**
 * app/backtest/page.tsx
 *
 * Backtest page.
 * Allows users to configure and run a backtest, then view the resulting metrics,
 * equity curve, and trade log.
 *
 * Data:    useBacktest hook for run state, SSE progress, and result data.
 * Layout:  Top = BacktestForm, Bottom = BacktestResults (shown after run completes).
 */

"use client";

import BacktestForm from "../../features/backtest/BacktestForm";
import BacktestResults from "../../features/backtest/BacktestResults";
import PnLChart from "../../components/charts/PnLChart";
import { useBacktest, type QueueStatus } from "../../hooks/useBacktest";
import { useEffect, useRef, useState } from "react";
import type { BacktestConfig } from "../../types/api";

/** A job still queued after this long probably has no worker to run it. */
const STUCK_QUEUE_MS = 15_000;

/** Pre-progress state of a run: waiting for a worker, or loading market data. */
function QueueNotice({ status, queuedAt }: { status: QueueStatus | null; queuedAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== "queued") return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [status]);

  if (status === "running") {
    return <p className="text-sm text-zinc-400">Running — loading market data…</p>;
  }
  const stuck = status === "queued" && queuedAt !== null && now - queuedAt > STUCK_QUEUE_MS;
  return (
    <div className="space-y-1">
      <p className="text-sm text-zinc-400">Queued — waiting for a backtest worker…</p>
      {stuck && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          No worker has picked this up yet. Backtests run in a separate worker process — start one
          with <code className="font-mono">npm run dev:worker</code> in <code className="font-mono">backend/</code>
          {" "}(<code className="font-mono">npm run dev</code> starts it too).
        </p>
      )}
    </div>
  );
}

export default function BacktestPage() {
  const {
    selectedResult, previousResult, isRunning, isSaving, progress, queueStatus, queuedAt, reused,
    error, saveError, run, rerun, save, loadResult,
  } = useBacktest();

  // Review-page links include a saved result id. Load it on arrival instead of
  // showing the empty run form and making the "Open" action appear broken.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) void loadResult(id);
  }, [loadResult]);

  // Keep the last submitted config so Re-run can re-submit it without the form
  const lastConfigRef = useRef<Omit<BacktestConfig, "id"> | null>(null);

  const handleRun = async (config: Omit<BacktestConfig, "id">) => {
    lastConfigRef.current = config;
    await run(config);
  };

  const handleSave = (id: string) => {
    // Fire-and-forget from the button's perspective — errors surface via saveError
    // below rather than a thrown promise the click handler would need to catch.
    save(id).catch(() => {});
  };

  const handleRerun = async () => {
    if (lastConfigRef.current) await rerun(lastConfigRef.current);
  };

  const showComparison = !isRunning && !!selectedResult && !!previousResult;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Backtest</h1>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Configuration form */}
        <div className="lg:col-span-1">
          <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase tracking-wide">
            Configuration
          </h2>
          <BacktestForm onSubmit={handleRun} isLoading={isRunning} />
        </div>

        {/* Results */}
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase tracking-wide">
            Results
          </h2>
          {error && (
            <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}
          {saveError && (
            <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {saveError}
            </div>
          )}
          {isRunning && !progress && <QueueNotice status={queueStatus} queuedAt={queuedAt} />}
          {!isRunning && reused && selectedResult && (
            <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
              An identical run already existed, so its result was reused instead of re-simulating. Use Re-run to force a fresh one.
            </p>
          )}
          {isRunning && progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-zinc-400">
                <span>Running backtest…</span>
                <span>
                  {progress.pct}% — {progress.barIndex.toLocaleString()} / ~{progress.totalBars.toLocaleString()} bars
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700">
                <div
                  className="h-1.5 rounded-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
            </div>
          )}

          {/* Side-by-side comparison when a re-run has completed */}
          {showComparison && (
            <div className="flex flex-col gap-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Previous</p>
                  <BacktestResults result={previousResult} onSave={handleSave} isSaving={isSaving} showChart={false} />
                </div>
                <div className="rounded-lg border border-blue-200 p-4 dark:border-blue-900">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-blue-500">New run</p>
                  <BacktestResults
                    result={selectedResult}
                    onRerun={handleRerun}
                    onSave={handleSave}
                    isSaving={isSaving}
                    showChart={false}
                  />
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Equity curve — new run</p>
                <PnLChart data={selectedResult.equity_curve ?? []} height={280} />
              </div>
            </div>
          )}

          {/* Single result (no comparison) */}
          {!isRunning && selectedResult && !previousResult && (
            <BacktestResults result={selectedResult} onRerun={handleRerun} onSave={handleSave} isSaving={isSaving} />
          )}

          {!isRunning && !selectedResult && !error && (
            <p className="text-sm text-zinc-400">
              Configure a backtest on the left and click Run.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
