/**
 * features/performance/PerformancePanel.tsx
 *
 * Metric grid and equity curve shared by backtest results and live run /
 * strategy performance, so the two read the same way side by side.
 *
 * Inputs:  metrics (backtest PerformanceMetrics or live LiveMetrics), curve.
 * Outputs: Rendered metric cards and PnL chart.
 */

"use client";

import PnLChart from "../../components/charts/PnLChart";
import { formatCurrency, formatPercent, pnlColorClass } from "../../utils/formatting";

/** The fields both a backtest's metrics and a live report's metrics carry. */
export interface PanelMetrics {
  totalReturnPct: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  sharpeRatio?: number;
  sortinoRatio?: number;
  avgWin: number;
  avgLoss: number;
  /** Live only: PnL in dollars and its split. */
  totalReturn?: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  profitFactor?: number;
}

interface Props {
  metrics: PanelMetrics;
  curve: { ts: number | string; equity: number }[];
  showChart?: boolean;
  chartHeight?: number;
  /** Shows the live PnL row (dollars, realized, unrealized, profit factor). */
  live?: boolean;
}

export default function PerformancePanel({ metrics, curve, showChart = true, chartHeight = 280, live = false }: Props) {
  const cards: { label: string; value: string; className?: string }[] = [
    { label: "Total Return", value: formatPercent(metrics.totalReturnPct), className: pnlColorClass(metrics.totalReturnPct) },
    { label: "Max Drawdown", value: formatPercent(-metrics.maxDrawdown) },
    { label: "Win Rate", value: formatPercent(metrics.winRate) },
    { label: "Total Trades", value: String(metrics.totalTrades) },
    { label: "Sharpe Ratio", value: metrics.sharpeRatio != null ? metrics.sharpeRatio.toFixed(2) : "—" },
    { label: "Sortino Ratio", value: metrics.sortinoRatio != null ? metrics.sortinoRatio.toFixed(2) : "—" },
    { label: "Avg Win", value: formatCurrency(metrics.avgWin) },
    { label: "Avg Loss", value: formatCurrency(metrics.avgLoss) },
  ];
  if (live) {
    cards.unshift(
      { label: "PnL", value: formatCurrency(metrics.totalReturn ?? 0), className: pnlColorClass(metrics.totalReturn ?? 0) },
      { label: "Realized", value: formatCurrency(metrics.realizedPnl ?? 0), className: pnlColorClass(metrics.realizedPnl ?? 0) },
      { label: "Unrealized", value: formatCurrency(metrics.unrealizedPnl ?? 0), className: pnlColorClass(metrics.unrealizedPnl ?? 0) },
      { label: "Profit Factor", value: metrics.profitFactor != null ? metrics.profitFactor.toFixed(2) : "—" },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map(({ label, value, className }) => (
          <div key={label}>
            <dt className="text-xs text-zinc-500">{label}</dt>
            <dd className={`mt-1 text-base font-semibold tabular-nums ${className ?? "text-zinc-900 dark:text-zinc-50"}`}>{value}</dd>
          </div>
        ))}
      </dl>
      {showChart && <PnLChart data={curve} height={chartHeight} />}
    </div>
  );
}
