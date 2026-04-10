/**
 * components/charts/PnLChart.tsx
 *
 * Equity curve / PnL chart component. Renders the portfolio equity over time
 * using the PortfolioSnapshot array from the equity curve endpoint.
 *
 * Uses a placeholder SVG path until a charting library (Recharts, Chart.js,
 * or Lightweight Charts) is installed. Wire up the charting library here.
 *
 * Inputs:  PortfolioSnapshot[] equityCurve data array.
 * Outputs: Rendered equity curve chart.
 */

"use client";

import type { PortfolioSnapshot } from "../../types/portfolio";
import { formatCurrency } from "../../utils/formatting";

interface Props {
  data: PortfolioSnapshot[];
  height?: number;
}

export default function PnLChart({ data, height = 240 }: Props) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
        style={{ height }}
      >
        No equity curve data
      </div>
    );
  }

  const latest = data[data.length - 1];
  const first = data[0];
  const pnl = latest ? latest.equity - (first?.equity ?? 0) : 0;

  return (
    <div
      className="flex flex-col rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      style={{ height }}
    >
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Equity Curve</span>
        <span className={`text-sm font-medium tabular-nums ${pnl >= 0 ? "text-green-600" : "text-red-600"}`}>
          {pnl >= 0 ? "+" : ""}{formatCurrency(pnl)}
        </span>
      </div>
      {/* TODO: Replace with a real charting library (e.g. Recharts <LineChart />) */}
      <div className="flex flex-1 items-center justify-center rounded bg-zinc-50 text-xs text-zinc-300 dark:bg-zinc-800 dark:text-zinc-600">
        Chart placeholder — {data.length} data points
        <br />
        Install Recharts or Lightweight Charts to render
      </div>
    </div>
  );
}
