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
import { useBacktest } from "../../hooks/useBacktest";

export default function BacktestPage() {
  const { selectedResult, isRunning, progress, error, run } = useBacktest();

  const handleRun = async (config: Parameters<typeof run>[0]) => {
    await run(config);
  };

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
          {isRunning && !progress && (
            <p className="text-sm text-zinc-400">Connecting…</p>
          )}
          {isRunning && progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-zinc-400">
                <span>Running backtest…</span>
                <span>
                  {progress.pct}% — {progress.barIndex.toLocaleString()} / {progress.totalBars.toLocaleString()} bars
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
          {!isRunning && selectedResult && <BacktestResults result={selectedResult} />}
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
