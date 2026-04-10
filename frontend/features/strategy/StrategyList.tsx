/**
 * features/strategy/StrategyList.tsx
 *
 * List of all strategy runs. Displays a StrategyStatusCard for each run
 * and provides stop controls for active strategies.
 *
 * Inputs:  runs array, onStop callback.
 * Outputs: Grid of StrategyStatusCard components.
 */

"use client";

import StrategyStatusCard from "../../components/cards/StrategyStatusCard";
import type { StrategyRun } from "../../types/strategy";

interface Props {
  runs: StrategyRun[];
  onStop: (id: string) => Promise<void>;
}

export default function StrategyList({ runs, onStop }: Props) {
  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-8 text-center text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
        No strategy runs yet. Create one above to get started.
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {runs.map((run) => (
        <StrategyStatusCard key={run.id} run={run} onStop={onStop} />
      ))}
    </div>
  );
}
