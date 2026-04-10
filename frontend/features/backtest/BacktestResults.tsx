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
import { formatDuration } from "../../utils/dates";

interface Props {
  result: BacktestResult & {
    equityCurve?: PortfolioSnapshot[];
    metrics?: PerformanceMetrics;
  };
}

export default function BacktestResults({ result }: Props) {
  const metrics = result.metrics;
  const equityCurve = result.equityCurve ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{result.config.name}</h3>
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
