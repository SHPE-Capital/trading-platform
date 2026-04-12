/**
 * app/strategies/page.tsx
 *
 * Strategy management page.
 * Shows all strategy runs (active + historical) and a form to launch a new strategy.
 *
 * Data:    useStrategies hook for run list and launch/stop actions.
 * Layout:  Two-panel: left = launch form, right = strategy list.
 */

"use client";

import StrategyForm from "../../features/strategy/StrategyForm";
import StrategyList from "../../features/strategy/StrategyList";
import { useStrategies } from "../../hooks/useStrategies";

export default function StrategiesPage() {
  const { runs, isLoading, launchStrategy, stopStrategy } = useStrategies();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Strategies</h1>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Launch form */}
        <div className="lg:col-span-1">
          <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase tracking-wide">
            Launch Strategy
          </h2>
          <StrategyForm onSubmit={launchStrategy} />
        </div>

        {/* Strategy list */}
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
