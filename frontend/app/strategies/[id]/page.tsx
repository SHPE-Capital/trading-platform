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

import { use, useEffect, useState } from "react";
import Link from "next/link";
import ZScoreChart from "../../../components/charts/ZScoreChart";
import SpreadChart from "../../../components/charts/SpreadChart";
import OrdersTable from "../../../components/tables/OrdersTable";
import FillsTable from "../../../components/tables/FillsTable";
import StrategyControls from "../../../components/controls/StrategyControls";
import { useStrategies } from "../../../hooks/useStrategies";
import { fetchOrders } from "../../../services/portfolioService";
import type { Order, Fill } from "../../../types/portfolio";

interface Props {
  params: Promise<{ id: string }>;
}

export default function StrategyDetailPage({ params }: Props) {
  const { id } = use(params);
  const { runs, stopStrategy } = useStrategies();

  const run = runs.find((r) => r.id === id) ?? null;

  const [orders, setOrders] = useState<Order[]>([]);
  const [fills, setFills] = useState<Fill[]>([]);

  useEffect(() => {
    if (!run) return;
    fetchOrders(run.id)
      .then((fetched) => {
        setOrders(fetched);
        setFills(fetched.flatMap((o) => o.fills ?? []));
      })
      .catch(() => {});
  }, [run?.id]);

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

  const startedLabel = run.startedAt
    ? new Date(run.startedAt).toLocaleString()
    : "—";

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
            {startedLabel}
          </p>
        </div>
        <StrategyControls strategyId={run.id} status={run.status} onStop={stopStrategy} />
      </div>

      {/* Charts */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-zinc-500">Z-Score</h2>
          <ZScoreChart
            data={[]}
            entryZScore={(run.config as Record<string, number>)?.entryZScore ?? 2}
            exitZScore={(run.config as Record<string, number>)?.exitZScore ?? 0.5}
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
        <OrdersTable orders={orders} />
      </div>

      {/* Fills */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-500">Fills</h2>
        <FillsTable fills={fills} />
      </div>
    </div>
  );
}
