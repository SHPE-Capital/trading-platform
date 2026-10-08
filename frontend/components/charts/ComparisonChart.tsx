/**
 * components/charts/ComparisonChart.tsx
 *
 * Several dollar series on one time axis — a run's live PnL against a backtest
 * of the same window and a buy-and-hold benchmark, or gross against net
 * exposure. Native SVG, like PnLChart.
 *
 * Inputs:  series [{ label, color, points: { ts, value }[] }].
 */

"use client";

import { formatCurrency } from "../../utils/formatting";

export interface ChartSeries {
  label: string;
  /** Tailwind-independent stroke colour. */
  color: string;
  points: { ts: number; value: number }[];
  dashed?: boolean;
}

const SVG_W = 600;
const PAD = { top: 12, right: 12, bottom: 28, left: 72 };

function fmtTick(ts: number, spanMs: number): string {
  const d = new Date(ts);
  return spanMs > 2 * 86_400_000
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function ComparisonChart({ series, height = 260 }: { series: ChartSeries[]; height?: number }) {
  const visible = series.filter((s) => s.points.length >= 2);
  if (visible.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
        style={{ height }}
      >
        Not enough data to compare yet
      </div>
    );
  }

  const all = visible.flatMap((s) => s.points);
  const minTs = Math.min(...all.map((p) => p.ts));
  const maxTs = Math.max(...all.map((p) => p.ts));
  const minV = Math.min(0, ...all.map((p) => p.value));
  const maxV = Math.max(0, ...all.map((p) => p.value));
  const tsRange = Math.max(1, maxTs - minTs);
  const vRange = Math.max(1e-9, maxV - minV);
  const plotW = SVG_W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (ts: number) => PAD.left + ((ts - minTs) / tsRange) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - minV) / vRange) * plotH;
  const yTicks = [minV, (minV + maxV) / 2, maxV];
  const xTicks = [minTs, minTs + tsRange / 2, maxTs];

  return (
    <div>
      <svg viewBox={`0 0 ${SVG_W} ${height}`} className="w-full" role="img" aria-label="Comparison chart">
        <line x1={PAD.left} x2={SVG_W - PAD.right} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity={0.2} />
        {yTicks.map((v) => (
          <text key={`y${v}`} x={PAD.left - 6} y={y(v) + 3} textAnchor="end" className="fill-zinc-400 text-[10px]">{formatCurrency(v, 0)}</text>
        ))}
        {xTicks.map((ts) => (
          <text key={`x${ts}`} x={x(ts)} y={height - 8} textAnchor="middle" className="fill-zinc-400 text-[10px]">{fmtTick(ts, tsRange)}</text>
        ))}
        {visible.map((s) => (
          <polyline
            key={s.label}
            fill="none"
            stroke={s.color}
            strokeWidth={1.5}
            strokeDasharray={s.dashed ? "4 3" : undefined}
            points={s.points.map((p) => `${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")}
          />
        ))}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-500">
        {visible.map((s) => {
          const last = s.points[s.points.length - 1].value;
          return (
            <li key={s.label} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4" style={{ backgroundColor: s.color }} />
              {s.label}: <span className="font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">{formatCurrency(last)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
