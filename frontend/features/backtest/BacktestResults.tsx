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
import type { PortfolioSnapshot, PerformanceMetrics } from "../../types/portfolio";
import { formatPercent, formatCurrency } from "../../utils/formatting";
import { formatDuration, formatTimestamp } from "../../utils/dates";

interface Props {
  result: BacktestResult;
}

export default function BacktestResults({ result }: Props) {
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
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{result.config.name}</h3>
          {runMeta && (
            <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{runMeta}</p>
          )}
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${result.status === "completed" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
          {result.status}
        </span>
      </div>

      {metrics && (
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Total Return",   value: formatPercent(metrics.totalReturnPct) },
            { label: "Max Drawdown",   value: formatPercent(-metrics.maxDrawdown) },
            { label: "Win Rate",       value: formatPercent(metrics.winRate) },
            { label: "Total Trades",   value: String(metrics.totalTrades) },
          ].map(({ label, value }) => (
            <div key={label}>
              <dt className="text-xs text-zinc-500">{label}</dt>
              <dd className="mt-1 text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <PnLChart data={equityCurve} height={280} />
    </div>
  );
}
