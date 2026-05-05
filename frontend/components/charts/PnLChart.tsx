/**
 * components/charts/PnLChart.tsx
 *
 * Equity curve chart rendered as a native SVG polyline.
 * Receives live PortfolioSnapshot[] fed by the PORTFOLIO_UPDATED WebSocket
 * event stream (via usePortfolio) and also the initial REST poll on mount.
 *
 * Inputs:  PortfolioSnapshot[] equityCurve data array.
 * Outputs: SVG line chart with Y-axis equity labels and X-axis time labels.
 */

"use client";

import type { PortfolioSnapshot } from "../../types/portfolio";
import { formatCurrency } from "../../utils/formatting";

interface Props {
  data: PortfolioSnapshot[];
  height?: number;
}

const SVG_W = 600;
const PAD = { top: 12, right: 12, bottom: 32, left: 64 };

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  // Show date if span exceeds 24 h
  return `${h}:${m}`;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

  const latest = data[data.length - 1]!;
  const first = data[0]!;
  const pnl = latest.equity - first.equity;

  // If all points are the same timestamp (single fill), give a minimal span
  const minTs = first.ts;
  const maxTs = latest.ts;
  const tsRange = maxTs - minTs || 1;

  const equities = data.map((d) => d.equity);
  const minEquity = Math.min(...equities);
  const maxEquity = Math.max(...equities);
  const equityRange = maxEquity - minEquity || 1;

  const innerW = SVG_W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom - 48; // 48 = header row

  const toX = (ts: number): number => PAD.left + ((ts - minTs) / tsRange) * innerW;
  const toY = (eq: number): number => PAD.top + (1 - (eq - minEquity) / equityRange) * innerH;

  const points = data.map((d) => `${toX(d.ts).toFixed(1)},${toY(d.equity).toFixed(1)}`).join(" ");
  const lineColor = pnl >= 0 ? "#16a34a" : "#dc2626";
  const labelColor = "#a1a1aa"; // zinc-400

  // Y-axis: 4 evenly-spaced ticks
  const Y_TICKS = 4;
  const yTicks = Array.from({ length: Y_TICKS }, (_, i) => {
    const frac = i / (Y_TICKS - 1);
    const value = minEquity + frac * equityRange;
    const y = toY(value);
    return { value, y };
  });

  // X-axis: 3 evenly-spaced ticks
  const X_TICKS = 3;
  const showDate = tsRange > 86_400_000;
  const xTicks = Array.from({ length: X_TICKS }, (_, i) => {
    const frac = i / (X_TICKS - 1);
    const ts = minTs + frac * tsRange;
    const x = toX(ts);
    return { ts, x };
  });

  // Baseline — where initialCapital sits (if within visible range)
  const initialCapital = first.initialCapital;
  const showBaseline =
    initialCapital >= minEquity && initialCapital <= maxEquity && equityRange > 1;
  const baselineY = toY(initialCapital);

  return (
    <div
      className="flex flex-col rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      style={{ height }}
    >
      {/* Header */}
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Equity Curve</span>
        <span className={`text-sm font-medium tabular-nums ${pnl >= 0 ? "text-green-600" : "text-red-600"}`}>
          {pnl >= 0 ? "+" : ""}{formatCurrency(pnl)}
        </span>
      </div>

      {/* Chart */}
      <svg
        viewBox={`0 0 ${SVG_W} ${innerH + PAD.top + PAD.bottom}`}
        className="w-full flex-1"
        preserveAspectRatio="none"
      >
        {/* Y-axis grid lines + labels */}
        {yTicks.map(({ value, y }) => (
          <g key={value}>
            <line
              x1={PAD.left} y1={y} x2={SVG_W - PAD.right} y2={y}
              stroke="#e4e4e7" strokeWidth="0.5"
            />
            <text
              x={PAD.left - 6} y={y + 4}
              textAnchor="end" fontSize="10" fill={labelColor}
            >
              {formatCurrency(value, 0)}
            </text>
          </g>
        ))}

        {/* Baseline (initialCapital) */}
        {showBaseline && (
          <line
            x1={PAD.left} y1={baselineY} x2={SVG_W - PAD.right} y2={baselineY}
            stroke="#a1a1aa" strokeWidth="0.75" strokeDasharray="4 3"
          />
        )}

        {/* Equity line */}
        <polyline
          points={points}
          fill="none"
          stroke={lineColor}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />

        {/* X-axis labels */}
        {xTicks.map(({ ts, x }) => (
          <text
            key={ts}
            x={x} y={innerH + PAD.top + PAD.bottom - 4}
            textAnchor="middle" fontSize="10" fill={labelColor}
          >
            {showDate ? fmtDate(ts) : fmtTime(ts)}
          </text>
        ))}
      </svg>
    </div>
  );
}
