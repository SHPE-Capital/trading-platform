/**
 * features/strategy/StrategyList.tsx
 *
 * Strategy runs grouped by the saved strategy they ran, newest strategy
 * activity first. Each group links to the strategy's lifetime performance;
 * each card links to its run.
 *
 * Inputs:  runs array, onStop callback.
 * Outputs: Grouped grid of StrategyStatusCard components.
 */

"use client";

import Link from "next/link";
import StrategyStatusCard from "../../components/cards/StrategyStatusCard";
import type { StrategyRun } from "../../types/strategy";
import { formatCurrency, pnlColorClass } from "../../utils/formatting";

interface Props {
  runs: StrategyRun[];
  onStop: (id: string) => Promise<void>;
}

interface Group {
  strategyId: string;
  name: string;
  runs: StrategyRun[];
  pnl: number;
  latest: number;
}

function groupRuns(runs: StrategyRun[]): Group[] {
  const groups = new Map<string, Group>();
  for (const run of runs) {
    const g = groups.get(run.strategyId) ?? { strategyId: run.strategyId, name: run.name, runs: [], pnl: 0, latest: 0 };
    g.runs.push(run);
    g.pnl += (run.realizedPnl ?? 0) + (run.unrealizedPnl ?? 0);
    g.latest = Math.max(g.latest, run.startedAt ?? 0);
    groups.set(run.strategyId, g);
  }
  return [...groups.values()].sort((a, b) => b.latest - a.latest);
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
    <div className="flex flex-col gap-8">
      {groupRuns(runs).map((g) => (
        <section key={g.strategyId}>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {g.name}
              <span className="ml-2 text-xs font-normal text-zinc-400">{g.runs.length} run{g.runs.length === 1 ? "" : "s"}</span>
            </h3>
            <Link href={`/strategies/${g.strategyId}`} className="text-xs font-medium text-zinc-600 hover:underline dark:text-zinc-300">
              Lifetime <span className={pnlColorClass(g.pnl)}>{formatCurrency(g.pnl)}</span> · Performance →
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {g.runs.map((run) => (
              <StrategyStatusCard key={run.id} run={run} onStop={onStop} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
