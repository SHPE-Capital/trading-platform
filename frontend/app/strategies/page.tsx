/**
 * app/strategies/page.tsx
 *
 * Strategy management page.
 * Shows all strategy runs (active + historical) and a form to launch a new strategy.
 */

"use client";

import StrategyForm from "../../features/strategy/StrategyForm";
import StrategyList from "../../features/strategy/StrategyList";
import { useStrategies } from "../../hooks/useStrategies";

export default function StrategiesPage() {
  const { runs, isLoading, error, startStrategy, stopStrategy } = useStrategies();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Strategies</h1>

      {error && (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase tracking-wide">
            Launch Strategy
          </h2>
          <StrategyForm onSubmit={startStrategy} />
        </div>

        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase tracking-wide">
            All Runs
          </h2>
          {isLoading ? (
            <p className="text-sm text-zinc-400">Loading strategies…</p>
          ) : (
            <StrategyList runs={runs} onStop={stopStrategy} />
          )}
        </div>
      </div>
    </div>
  );
}
