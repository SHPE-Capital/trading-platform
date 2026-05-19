/**
 * features/backtest/BacktestResults.tsx
 *
 * Displays the results of a completed backtest run:
 * performance metrics summary and the equity curve chart.
 *
 * Inputs:  BacktestResult object (with metrics and equity curve).
 * Outputs: Rendered results panel with metric cards and PnL chart.
 */

"use client";

import PnLChart from "../../components/charts/PnLChart";
import type { BacktestResult } from "../../types/api";
import { formatPercent, formatCurrency } from "../../utils/formatting";
import { formatDuration, formatTimestamp } from "../../utils/dates";

interface Props {
  result: BacktestResult;
  onRerun?: () => void;
  showChart?: boolean;
}

export default function BacktestResults({ result, onRerun, showChart = true }: Props) {
  const metrics = result.metrics;
  const equityCurve = result.equity_curve ?? [];
  const isReused = !!result.reused_from_id;
  const duration =
    result.completed_at && result.started_at
      ? result.completed_at - result.started_at
      : null;

  const runMeta = isReused
    ? `Reused from ${result.completed_at ? formatTimestamp(result.completed_at) : "previous run"}`
    : result.completed_at
      ? `Completed ${formatTimestamp(result.completed_at)}${duration ? ` · Ran in ${formatDuration(duration)}` : ""}`
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{result.config.name}</h3>
          {runMeta && (
            <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{runMeta}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(result.strategy_version ?? result.config.strategyVersion) != null && (
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              v{result.strategy_version ?? result.config.strategyVersion}
            </span>
          )}
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${result.status === "completed" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
            {result.status}
          </span>
          {onRerun && (
            <button
              type="button"
              onClick={onRerun}
              className="rounded-md border border-zinc-300 px-2.5 py-0.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Re-run
            </button>
          )}
        </div>
      </div>

      {metrics && (
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {([
            { label: "Total Return",  value: formatPercent(metrics.totalReturnPct) },
            { label: "Max Drawdown",  value: formatPercent(-metrics.maxDrawdown) },
            { label: "Win Rate",      value: formatPercent(metrics.winRate) },
            { label: "Total Trades",  value: String(metrics.totalTrades) },
            { label: "Sharpe Ratio",  value: metrics.sharpeRatio != null ? metrics.sharpeRatio.toFixed(2) : "—" },
            { label: "Sortino Ratio", value: metrics.sortinoRatio != null ? metrics.sortinoRatio.toFixed(2) : "—" },
            { label: "Avg Win",       value: formatCurrency(metrics.avgWin) },
            { label: "Avg Loss",      value: formatCurrency(metrics.avgLoss) },
          ] as { label: string; value: string }[]).map(({ label, value }) => (
            <div key={label}>
              <dt className="text-xs text-zinc-500">{label}</dt>
              <dd className="mt-1 text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {showChart && <PnLChart data={equityCurve} height={280} />}
    </div>
  );
}
