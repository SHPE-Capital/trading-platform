/**
 * app/strategies/[id]/page.tsx
 *
 * A saved strategy's lifetime performance: every run of it in the selected
 * mode, chained by dollar PnL, beside the latest saved backtest of the same
 * version — so live and backtest numbers read side by side. Filters narrow it
 * to one version or to (or away from) sandbox runs.
 *
 * Inputs:  params.id — strategies.id. Links from before this page existed
 *          carried a run id here; those are forwarded to /runs/[id].
 */

"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PerformancePanel from "../../../features/performance/PerformancePanel";
import CompareSection from "../../../features/performance/CompareSection";
import {
  HoldingTimesCard, OpenPositionsTable, RejectionsCard, RunsTable, Section, SignalFunnelCard,
  SlippageCard, SymbolTable, TradesTable,
} from "../../../features/performance/ReportSections";
import { useStrategyPerformance } from "../../../hooks/usePerformance";
import { useStrategyVersions } from "../../../hooks/useStrategyVersions";
import { fetchStrategyRun } from "../../../services/strategiesService";
import { fetchBacktests } from "../../../services/backtestService";
import { formatTimestamp } from "../../../utils/dates";
import type { BacktestResult } from "../../../types/api";

interface Props {
  params: Promise<{ id: string }>;
}

type SandboxFilter = "include" | "exclude" | "only";

export default function StrategyPerformancePage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const [mode, setMode] = useState<"paper" | "live">("paper");
  const [versionId, setVersionId] = useState<string>("");
  const [sandbox, setSandbox] = useState<SandboxFilter>("include");
  const [backtests, setBacktests] = useState<BacktestResult[]>([]);

  const filter = useMemo(() => ({ mode, versionId: versionId || undefined, sandbox }), [mode, versionId, sandbox]);
  const { report, isLoading, error } = useStrategyPerformance(id, filter);
  const { versions } = useStrategyVersions(id);

  // An old link to /strategies/<runId>: forward it to the run page.
  useEffect(() => {
    if (!error?.toLowerCase().includes("not found")) return;
    fetchStrategyRun(id).then(() => router.replace(`/runs/${id}`)).catch(() => {});
  }, [error, id, router]);

  useEffect(() => {
    fetchBacktests().then(setBacktests).catch(() => {});
  }, []);

  const latestBacktest = useMemo(() => {
    // Run-window comparisons are diagnostics, not the strategy's reference backtest.
    const matching = backtests.filter((b) =>
      b.status === "completed" && b.metrics && !b.config.sourceRunId
      && b.config.strategyId === id && (!versionId || b.config.strategyVersionId === versionId));
    return matching.sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0))[0] ?? null;
  }, [backtests, id, versionId]);

  const select = "rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/strategies" className="mb-1 inline-block text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        ← Strategies
      </Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{report?.name ?? "Strategy"}</h1>
          <p className="text-xs text-zinc-400">
            {report ? `${report.strategyType} · lifetime across ${report.runs?.length ?? 0} run(s)` : ""}
            {report && report.runs && report.runs.length > 0 && ` · ${formatTimestamp(report.periodStart)} → ${formatTimestamp(report.periodEnd)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <label className="flex items-center gap-1 text-zinc-500">Mode
            <select className={select} value={mode} onChange={(e) => setMode(e.target.value as "paper" | "live")}>
              <option value="paper">Paper</option>
              <option value="live">Live</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-zinc-500">Version
            <select className={select} value={versionId} onChange={(e) => setVersionId(e.target.value)}>
              <option value="">All versions</option>
              {versions.map((v) => <option key={v.id} value={v.id}>v{v.versionNumber}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 text-zinc-500">Sandbox runs
            <select className={select} value={sandbox} onChange={(e) => setSandbox(e.target.value as SandboxFilter)}>
              <option value="include">Included</option>
              <option value="exclude">Excluded</option>
              <option value="only">Only</option>
            </select>
          </label>
        </div>
      </div>

      {error && !error.toLowerCase().includes("not found") && <p className="mb-4 text-sm text-red-500">{error}</p>}
      {isLoading && !report && <p className="text-sm text-zinc-400">Loading performance…</p>}

      {report && (
        <div className="flex flex-col gap-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Section title="Live" hint={`${mode === "paper" ? "Paper" : "Real-money"} runs, chained by dollar PnL; returns over the largest capital base.`}>
                <PerformancePanel live metrics={report.metrics} curve={report.equityCurve} />
              </Section>
            </div>
            <Section
              title="Latest backtest"
              hint={latestBacktest
                ? `${latestBacktest.config.name} · ${latestBacktest.config.startDate} → ${latestBacktest.config.endDate}`
                : "No saved backtest of this strategy" + (versionId ? " version." : ".")}
            >
              {latestBacktest?.metrics && (
                <PerformancePanel metrics={latestBacktest.metrics} curve={[]} showChart={false} />
              )}
            </Section>
          </div>

          <CompareSection report={report} />

          <RunsTable runs={report.runs ?? []} />

          <div className="grid gap-6 lg:grid-cols-3">
            <SignalFunnelCard funnel={report.funnel} />
            <RejectionsCard rejections={report.rejectionsByCheck} />
            <SlippageCard slippage={report.slippage} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <SymbolTable rows={report.bySymbol} />
            <HoldingTimesCard buckets={report.holdingTimes} />
          </div>

          <OpenPositionsTable positions={report.openPositions} />
          <TradesTable trades={report.trades} />
        </div>
      )}
    </div>
  );
}
