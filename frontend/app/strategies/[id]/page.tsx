/**
 * app/strategies/[id]/page.tsx
 *
 * Individual strategy detail page.
 * Shows run metadata, live z-score chart, spread chart, and per-run orders/fills.
 *
 * Inputs:  params.id — strategy run UUID from the URL segment.
 * Outputs: Rendered detail view for the given strategy run.
 */

"use client";

import { use } from "react";
import Link from "next/link";
import ZScoreChart from "../../../components/charts/ZScoreChart";
import SpreadChart from "../../../components/charts/SpreadChart";
import OrdersTable from "../../../components/tables/OrdersTable";
import FillsTable from "../../../components/tables/FillsTable";
import StrategyControls from "../../../components/controls/StrategyControls";
import { useStrategies } from "../../../hooks/useStrategies";

interface Props {
  params: Promise<{ id: string }>;
}

export default function StrategyDetailPage({ params }: Props) {
  const { id } = use(params);
  const { runs, stopStrategy } = useStrategies();

  const run = runs.find((r) => r.id === id) ?? null;

  if (!run) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          href="/strategies"
          className="mb-4 inline-block text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← Back to Strategies
        </Link>
        <p className="text-sm text-zinc-400">Strategy run not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href="/strategies"
            className="mb-1 inline-block text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            ← Back to Strategies
          </Link>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            {run.strategyType} — {run.id.slice(0, 8)}
          </h1>
          <p className="text-xs text-zinc-400">
            Status: <span className="font-medium">{run.status}</span> · Started:{" "}
            {new Date(run.startedAt).toLocaleString()}
          </p>
        </div>
        <StrategyControls run={run} onStop={stopStrategy} />
      </div>

      {/* Charts */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-zinc-500">Z-Score</h2>
          <ZScoreChart
            data={[]}
            entryThreshold={(run.config as Record<string, number>)?.entryZScore ?? 2}
            exitThreshold={(run.config as Record<string, number>)?.exitZScore ?? 0.5}
            height={240}
          />
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold text-zinc-500">Spread</h2>
          <SpreadChart data={[]} height={240} />
        </div>
      </div>

      {/* Orders */}
      <div className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-zinc-500">Orders</h2>
        <OrdersTable orders={run.orders ?? []} />
      </div>

      {/* Fills */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-500">Fills</h2>
        <FillsTable fills={run.fills ?? []} />
      </div>
    </div>
  );
}
