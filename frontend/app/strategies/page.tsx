/**
 * app/strategies/page.tsx
 *
 * Strategy management page.
 * Shows all strategy runs (active + historical) and a form to launch a new strategy.
 * The strategy picker lists whatever the backend catalog marks "ready": pairs
 * trading keeps its bespoke form, every other type gets the generic form.
 */

"use client";

import { useState } from "react";
import StrategyForm from "../../features/strategy/StrategyForm";
import GenericStrategyForm from "../../features/strategy/GenericStrategyForm";
import StrategyList from "../../features/strategy/StrategyList";
import { useStrategies } from "../../hooks/useStrategies";
import { useStrategyTypes } from "../../hooks/useStrategyTypes";
import type { StrategyType } from "../../types/strategy";

const DEFAULT_TYPE: StrategyType = "pairs_trading";

export default function StrategiesPage() {
  const { runs, isLoading, error, startStrategy, stopStrategy } = useStrategies();
  const { types } = useStrategyTypes();
  const [selectedType, setSelectedType] = useState<StrategyType>(DEFAULT_TYPE);

  // A type is launchable from here when it has the bespoke form or describes its params.
  const options = types.filter((t) => t.actions?.startTrading.allowed !== false && (t.type === DEFAULT_TYPE || (t.params?.length ?? 0) > 0));
  const activeType = options.some((t) => t.type === selectedType) ? selectedType : DEFAULT_TYPE;

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
          {options.length > 1 && (
            <div className="mb-4 flex flex-col gap-1">
              <label htmlFor="strategy-type" className="text-xs font-medium text-zinc-500">Strategy Type</label>
              <select
                id="strategy-type"
                value={activeType}
                onChange={(e) => setSelectedType(e.target.value as StrategyType)}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              >
                {options.map((t) => (
                  <option key={t.type} value={t.type}>{t.label}</option>
                ))}
              </select>
            </div>
          )}
          {activeType === DEFAULT_TYPE ? (
            <StrategyForm onSubmit={startStrategy} />
          ) : (
            <GenericStrategyForm key={activeType} type={activeType} onSubmit={startStrategy} />
          )}
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
