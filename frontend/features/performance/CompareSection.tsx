/**
 * features/performance/CompareSection.tsx
 *
 * Live PnL against what else the same capital could have done over the same
 * window: a buy-and-hold benchmark, and (for a run) a backtest of the run's
 * exact window and config. Live tracking its backtest but losing to it points
 * at execution (slippage, missed fills); both losing points at the strategy.
 *
 * Inputs:  the performance report; for a run, its id, type and any existing
 *          comparison backtest id (strategy_runs.meta.compareBacktestId).
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import ComparisonChart, { type ChartSeries } from "../../components/charts/ComparisonChart";
import PerformancePanel from "./PerformancePanel";
import { Section } from "./ReportSections";
import { compareRunWithBacktest } from "../../services/performanceService";
import { fetchBacktest, saveBacktest } from "../../services/backtestService";
import { formatPercent, pnlColorClass } from "../../utils/formatting";
import type { PerformanceReport } from "../../types/analytics";
import type { BacktestResult } from "../../types/api";

/** Strategy types the backtest engine can simulate (backend core/backtest/strategyFactory.ts). */
const BACKTESTABLE = new Set(["pairs_trading"]);
const POLL_MS = 5_000;

interface Props {
  report: PerformanceReport;
  run?: { id: string; strategyType: string; compareBacktestId?: string };
}

export default function CompareSection({ report, run }: Props) {
  const [backtestId, setBacktestId] = useState<string | null>(run?.compareBacktestId ?? null);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);

  useEffect(() => {
    if (run?.compareBacktestId) queueMicrotask(() => setBacktestId(run.compareBacktestId!));
  }, [run?.compareBacktestId]);

  // Poll the comparison backtest until it settles (the API answers "queued" or
  // "running" until then), and keep the result: an unsaved one expires.
  useEffect(() => {
    if (!backtestId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const bt = await fetchBacktest(backtestId);
        if (stopped) return;
        setBacktest(bt);
        if (bt.status !== "completed" && bt.status !== "failed") {
          timer = setTimeout(poll, POLL_MS);
        } else if (bt.status === "completed" && bt.saved_at == null && !bt.reused_from_id) {
          saveBacktest(backtestId).catch(() => {});
        }
      } catch (err) {
        if (stopped) return;
        // A finished comparison nobody saved in time is gone; offer a re-run.
        if (err instanceof Error && err.message.includes("not found")) {
          setBacktest(null);
          setQueueError("The previous comparison expired — run it again.");
        } else {
          timer = setTimeout(poll, POLL_MS);
        }
      }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [backtestId]);

  const queue = useCallback(async (force: boolean) => {
    if (!run) return;
    setQueueing(true);
    setQueueError(null);
    try {
      const { backtestId: id } = await compareRunWithBacktest(run.id, force);
      setBacktest(null);
      setBacktestId(id);
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : "Could not queue the backtest");
    } finally {
      setQueueing(false);
    }
  }, [run]);

  const series: ChartSeries[] = [
    { label: "Live", color: "#2563eb", points: report.equityCurve.map((p) => ({ ts: p.ts, value: p.pnl })) },
  ];
  if (backtest?.status === "completed" && backtest.equity_curve?.length) {
    const base = backtest.config.initialCapital;
    series.push({
      label: "Backtest",
      color: "#16a34a",
      points: backtest.equity_curve.map((s) => ({ ts: typeof s.ts === "number" ? s.ts : new Date(s.ts).getTime(), value: s.equity - base })),
    });
  }
  if (report.benchmark) {
    series.push({
      label: `${report.benchmark.symbol} buy & hold`,
      color: "#a1a1aa",
      dashed: true,
      points: report.benchmark.curve.map((p) => ({ ts: p.ts, value: p.pnl })),
    });
  }

  const benchmarkReturn = report.metrics.benchmarkReturn;
  const canBacktest = !!run && BACKTESTABLE.has(run.strategyType);
  const busy = !!backtest && backtest.status !== "completed" && backtest.status !== "failed";

  return (
    <Section
      title="Compared with"
      hint="Dollar PnL on the same capital. The backtest replays this run's exact window and config; it starts without warm-up history."
    >
      {benchmarkReturn != null && report.benchmark && (
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
          {report.benchmark.symbol} over the same window:{" "}
          <span className={`font-semibold ${pnlColorClass(benchmarkReturn)}`}>{formatPercent(benchmarkReturn)}</span>
          {" · "}this {report.scope}:{" "}
          <span className={`font-semibold ${pnlColorClass(report.metrics.totalReturnPct)}`}>{formatPercent(report.metrics.totalReturnPct)}</span>
        </p>
      )}

      <ComparisonChart series={series} />

      {run && (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          {canBacktest ? (
            <button
              type="button"
              disabled={queueing || busy}
              onClick={() => queue(!!backtestId)}
              className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {backtestId ? "Re-run the comparison backtest" : "Compare with a backtest of this window"}
            </button>
          ) : (
            <span className="text-xs text-zinc-400">Backtesting is not available for {run.strategyType} yet.</span>
          )}
          {busy && <span className="text-xs text-zinc-500">Backtest {backtest?.status}…</span>}
          {backtest?.status === "failed" && <span className="text-xs text-red-500">Backtest failed: {backtest.error_message}</span>}
          {queueError && <span className="text-xs text-red-500">{queueError}</span>}
        </div>
      )}

      {backtest?.status === "completed" && backtest.metrics && (
        <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Backtest of this window</p>
          <PerformancePanel metrics={backtest.metrics} curve={[]} showChart={false} />
        </div>
      )}
    </Section>
  );
}
