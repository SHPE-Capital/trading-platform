/**
 * components/charts/SpreadChart.tsx
 *
 * Spread time series chart for the pairs trading strategy.
 * Plots the raw spread value over time along with rolling mean bands.
 *
 * Inputs:  Array of { ts, spread, mean, upperBand, lowerBand } data points.
 * Outputs: Rendered spread chart with entry/exit threshold lines.
 *
 * TODO: Replace placeholder with a real charting library implementation.
 */

"use client";

interface SpreadDataPoint {
  ts: number;
  spread: number;
  mean?: number;
  upperBand?: number;
  lowerBand?: number;
}

interface Props {
  data: SpreadDataPoint[];
  height?: number;
  entryZScore?: number;
}

export default function SpreadChart({ data, height = 200, entryZScore }: Props) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
        style={{ height }}
      >
        No spread data
      </div>
    );
  }

  return (
    <div
      className="flex flex-col rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      style={{ height }}
    >
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Spread</span>
        {entryZScore && (
          <span className="text-xs text-zinc-400">Entry threshold: ±{entryZScore}σ</span>
        )}
      </div>
      {/* TODO: Replace with Recharts <LineChart /> or Lightweight Charts */}
      <div className="flex flex-1 items-center justify-center rounded bg-zinc-50 text-xs text-zinc-300 dark:bg-zinc-800 dark:text-zinc-600">
        Spread chart placeholder — {data.length} points
      </div>
    </div>
  );
}
