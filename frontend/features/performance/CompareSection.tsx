/**
 * features/performance/CompareSection.tsx
 *
 * Live PnL against what else the same capital could have done over the same
 * window: a buy-and-hold benchmark, and (for a run) backtests of the run's
 * exact window and config — one filling at bar opens, one at the real bid/ask.
 * Live tracking its backtest but losing to it points at execution (slippage,
 * missed fills); both losing points at the strategy.
 *
 * Inputs:  the performance report; for a run, its id, type and any existing
 *          comparison backtest ids (strategy_runs.meta.compareBacktestId and
 *          compareQuoteBacktestId).
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchStrategyDefaults } from "../../services/strategiesService";
import ComparisonChart, { type ChartSeries } from "../../components/charts/ComparisonChart";
import PerformancePanel from "./PerformancePanel";
import ExecutionSummary from "../backtest/ExecutionSummary";
import { Section } from "./ReportSections";
import { compareRunWithBacktest } from "../../services/performanceService";
import { fetchBacktest, saveBacktest } from "../../services/backtestService";
import { formatPercent, pnlColorClass } from "../../utils/formatting";
import type { PerformanceReport } from "../../types/analytics";
import type { BacktestResult, ExecutionSettings } from "../../types/api";

/** Strategy types the backtest engine can simulate (backend core/backtest/strategyFactory.ts). */
const POLL_MS = 5_000;
const QUOTE_FILLS: ExecutionSettings = { model: "quote" };

interface Props {
  report: PerformanceReport;
  run?: { id: string; strategyType: string; compareBacktestId?: string; compareQuoteBacktestId?: string };
}

/**
 * One comparison backtest of the run's window: queued on request, polled until
 * it settles, then saved so it does not expire. `execution` picks the fill
 * model; omitted, the backtest fills at bar opens.
 */
function useComparison(runId: string | undefined, existingId: string | undefined, execution?: ExecutionSettings) {
  const [backtestId, setBacktestId] = useState<string | null>(existingId ?? null);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);

  useEffect(() => {
    if (existingId) queueMicrotask(() => setBacktestId(existingId));
  }, [existingId]);

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
    if (!runId) return;
    setQueueing(true);
    setQueueError(null);
    try {
      const { backtestId: id } = execution
        ? await compareRunWithBacktest(runId, force, execution)
        : await compareRunWithBacktest(runId, force);
      setBacktest(null);
      setBacktestId(id);
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : "Could not queue the backtest");
    } finally {
      setQueueing(false);
    }
  }, [runId, execution]);

  const busy = !!backtest && backtest.status !== "completed" && backtest.status !== "failed";
  return { backtestId, backtest, queue, queueing, queueError, busy };
}

/** A completed comparison's equity as dollar PnL on its starting capital. */
function pnlSeries(backtest: BacktestResult, label: string, color: string): ChartSeries {
  const base = backtest.config.initialCapital;
  return {
    label,
    color,
    points: (backtest.equity_curve ?? []).map((s) => ({ ts: typeof s.ts === "number" ? s.ts : new Date(s.ts).getTime(), value: s.equity - base })),
  };
}

export default function CompareSection({ report, run }: Props) {
  const [capability, setCapability] = useState<{ type: string; allowed: boolean } | null>(null);
  const strategyType = run?.strategyType;
  const canBacktest = capability?.type === strategyType && capability?.allowed;
  useEffect(() => {
    let cancelled = false;
    if (strategyType) fetchStrategyDefaults(strategyType)
      .then((def) => { if (!cancelled) setCapability({ type: strategyType, allowed: def.actions?.backtest.allowed === true }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [strategyType]);
  const barFills = useComparison(run?.id, run?.compareBacktestId);
  const quoteFills = useComparison(run?.id, run?.compareQuoteBacktestId, QUOTE_FILLS);
  const backtest = barFills.backtest;
  const quoteBacktest = quoteFills.backtest;

  const series: ChartSeries[] = [
    { label: "Live", color: "#2563eb", points: report.equityCurve.map((p) => ({ ts: p.ts, value: p.pnl })) },
  ];
  if (backtest?.status === "completed" && backtest.equity_curve?.length) {
    series.push(pnlSeries(backtest, "Backtest", "#16a34a"));
  }
  if (quoteBacktest?.status === "completed" && quoteBacktest.equity_curve?.length) {
    series.push(pnlSeries(quoteBacktest, "Backtest, quote fills", "#d97706"));
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

  return (
    <Section
      title="Compared with"
      hint="Dollar PnL on the same capital. A backtest replays this run's exact window and config, filling at bar opens or at the real bid/ask; it starts without warm-up history."
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
            <>
              <button
                type="button"
                disabled={barFills.queueing || barFills.busy}
                onClick={() => barFills.queue(!!barFills.backtestId)}
                className={buttonClass}
              >
                {barFills.backtestId ? "Re-run the comparison backtest" : "Compare with a backtest of this window"}
              </button>
              <button
                type="button"
                disabled={quoteFills.queueing || quoteFills.busy}
                onClick={() => quoteFills.queue(!!quoteFills.backtestId)}
                title="Prices each order at the real bid/ask when it would have reached the market; set its fills beside this run's to see what execution cost"
                className={buttonClass}
              >
                {quoteFills.backtestId ? "Re-run with quote fills" : "Compare with quote fills"}
              </button>
            </>
          ) : (
            <span className="text-xs text-zinc-400">Backtesting is not available for {run.strategyType} yet.</span>
          )}
          <ComparisonStatus name="Backtest" comparison={barFills} />
          <ComparisonStatus name="Quote-fill backtest" comparison={quoteFills} />
        </div>
      )}

      {backtest?.status === "completed" && backtest.metrics && (
        <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Backtest of this window</p>
          <PerformancePanel metrics={backtest.metrics} curve={[]} showChart={false} />
        </div>
      )}

      {quoteBacktest?.status === "completed" && quoteBacktest.metrics && (
        <div className="mt-4 flex flex-col gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Backtest of this window, quote fills</p>
          <PerformancePanel metrics={quoteBacktest.metrics} curve={[]} showChart={false} />
          {quoteBacktest.metrics.meta?.execution && <ExecutionSummary report={quoteBacktest.metrics.meta.execution} />}
        </div>
      )}
    </Section>
  );
}

const buttonClass =
  "rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800";

/** A comparison's progress or failure, beside the buttons. */
function ComparisonStatus({ name, comparison }: { name: string; comparison: ReturnType<typeof useComparison> }) {
  const { backtest, busy, queueError } = comparison;
  return (
    <>
      {busy && <span className="text-xs text-zinc-500">{name} {backtest?.status}…</span>}
      {backtest?.status === "failed" && <span className="text-xs text-red-500">{name} failed: {backtest.error_message}</span>}
      {queueError && <span className="text-xs text-red-500">{queueError}</span>}
    </>
  );
}
