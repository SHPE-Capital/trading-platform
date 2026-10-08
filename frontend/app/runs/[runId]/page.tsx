/**
 * app/runs/[runId]/page.tsx
 *
 * One strategy run: its live performance from the ledger (same panel as a
 * backtest), where its signals went, what blocked them, per-symbol PnL, open
 * positions, slippage, holding times, closed trades, orders and fills, and the
 * runner events behind it.
 *
 * Inputs:  params.runId — strategy_runs.id.
 */

"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import StrategyControls from "../../../components/controls/StrategyControls";
import OrdersTable from "../../../components/tables/OrdersTable";
import FillsTable from "../../../components/tables/FillsTable";
import PerformancePanel from "../../../features/performance/PerformancePanel";
import CompareSection from "../../../features/performance/CompareSection";
import ComparisonChart from "../../../components/charts/ComparisonChart";
import {
  EventsTimeline, HoldingTimesCard, OpenPositionsTable, RejectionsCard, Section, SignalFunnelCard,
  SlippageCard, SymbolTable, TradesTable,
} from "../../../features/performance/ReportSections";
import { useRunPerformance } from "../../../hooks/usePerformance";
import { fetchStrategyRun, stopStrategyRun } from "../../../services/strategiesService";
import { fetchOrders } from "../../../services/portfolioService";
import { fetchRunFills } from "../../../services/performanceService";
import { formatCurrency } from "../../../utils/formatting";
import { formatTimestamp } from "../../../utils/dates";
import type { StrategyRun } from "../../../types/strategy";
import type { Fill, Order } from "../../../types/portfolio";

interface Props {
  params: Promise<{ runId: string }>;
}

export default function RunPage({ params }: Props) {
  const { runId } = use(params);
  const [run, setRun] = useState<StrategyRun | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [fills, setFills] = useState<Fill[]>([]);
  const live = run?.status === "running";
  const { report, isLoading, error, refetch } = useRunPerformance(runId, live ? 30_000 : 0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchStrategyRun(runId), fetchOrders(runId), fetchRunFills(runId)])
      .then(([r, o, f]) => {
        if (cancelled) return;
        setRun(r);
        setOrders([...o].reverse());
        setFills([...f].reverse());
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [runId, report]);

  const onStop = async (id: string) => {
    await stopStrategyRun(id);
    setRun((r) => (r ? { ...r, status: "stopped" } : r));
    refetch();
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link
            href={run ? `/strategies/${run.strategyId}` : "/strategies"}
            className="mb-1 inline-block text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            ← {run ? `All runs of ${run.name}` : "Strategies"}
          </Link>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{report?.name ?? run?.name ?? "Run"}</h1>
          <p className="mt-0.5 text-xs text-zinc-400">
            {[
              run?.status && `Status: ${run.status}`,
              run?.executionMode,
              run?.runtimeOrigin,
              run?.strategyVersion != null && `algo v${run.strategyVersion}`,
              run?.startedAt && `started ${formatTimestamp(run.startedAt)}`,
              run?.stoppedAt && `stopped ${formatTimestamp(run.stoppedAt)}`,
              report && `capital base ${formatCurrency(report.capitalBase, 0)}`,
            ].filter(Boolean).join(" · ")}
          </p>
        </div>
        {run && <StrategyControls strategyId={run.id} status={run.status} onStop={onStop} />}
      </div>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}
      {isLoading && !report && <p className="text-sm text-zinc-400">Loading performance…</p>}

      {report && (
        <div className="flex flex-col gap-6">
          <Section title="Performance" hint="From the ledger: this run's own fills, marked at the latest price.">
            <PerformancePanel live metrics={report.metrics} curve={report.equityCurve} />
          </Section>

          <CompareSection
            report={report}
            run={run ? {
              id: run.id,
              strategyType: run.strategyType,
              compareBacktestId: (run.meta?.compareBacktestId as string | undefined),
            } : undefined}
          />

          <div className="grid gap-6 lg:grid-cols-3">
            <SignalFunnelCard funnel={report.funnel} />
            <RejectionsCard rejections={report.rejectionsByCheck} />
            <SlippageCard slippage={report.slippage} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <SymbolTable rows={report.bySymbol} />
            <OpenPositionsTable positions={report.openPositions} stopped={!live} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <HoldingTimesCard buckets={report.holdingTimes} />
            <EventsTimeline events={report.events ?? []} />
          </div>

          {report.exposureCurve.length >= 2 && (
            <Section title="Exposure" hint="Gross and net market value of this run's own positions, sampled every minute.">
              <ComparisonChart
                height={200}
                series={[
                  { label: "Gross", color: "#f59e0b", points: report.exposureCurve.map((p) => ({ ts: p.ts, value: p.gross })) },
                  { label: "Net", color: "#2563eb", points: report.exposureCurve.map((p) => ({ ts: p.ts, value: p.net })) },
                ]}
              />
            </Section>
          )}

          <TradesTable trades={report.trades} />

          <Section title="Orders">
            <OrdersTable orders={orders} />
          </Section>
          <Section title="Fills">
            <FillsTable fills={fills} />
          </Section>
        </div>
      )}
    </div>
  );
}
