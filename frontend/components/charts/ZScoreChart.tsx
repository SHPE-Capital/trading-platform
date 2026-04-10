/**
 * components/charts/ZScoreChart.tsx
 *
 * Z-score time series chart for the pairs trading strategy.
 * Plots the z-score of the spread over time with horizontal threshold lines
 * indicating entry and exit levels.
 *
 * Inputs:  Array of { ts, zScore } data points, entry/exit threshold values.
 * Outputs: Rendered z-score chart with threshold lines.
 *
 * TODO: Replace placeholder with a real charting library implementation.
 */

"use client";

interface ZScoreDataPoint {
  ts: number;
  zScore: number;
}

interface Props {
  data: ZScoreDataPoint[];
  height?: number;
  entryZScore?: number;
  exitZScore?: number;
}

export default function ZScoreChart({ data, height = 200, entryZScore = 2, exitZScore = 0.5 }: Props) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
        style={{ height }}
      >
        No z-score data
      </div>
    );
  }

  const latest = data[data.length - 1];

  return (
    <div
      className="flex flex-col rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      style={{ height }}
    >
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Z-Score</span>
        <div className="flex gap-3 text-xs text-zinc-400">
          <span>Entry: ±{entryZScore}</span>
          <span>Exit: ±{exitZScore}</span>
          {latest && (
            <span className={`font-medium ${Math.abs(latest.zScore) >= entryZScore ? "text-amber-600" : "text-zinc-600"}`}>
              Now: {latest.zScore.toFixed(2)}
            </span>
          )}
        </div>
      </div>
      {/* TODO: Replace with Recharts <LineChart /> or Lightweight Charts */}
      <div className="flex flex-1 items-center justify-center rounded bg-zinc-50 text-xs text-zinc-300 dark:bg-zinc-800 dark:text-zinc-600">
        Z-score chart placeholder — {data.length} points
      </div>
    </div>
  );
}
