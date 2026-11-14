/**
 * app/momentum/page.tsx
 *
 * Momentum live page. Runs on mock data until P3-1's API lands: swap the data
 * source passed to useMomentumLive (see features/momentum/types.ts).
 */

"use client";

import { MomentumLiveView } from "../../features/momentum/MomentumLiveView";
import { useMomentumLive } from "../../features/momentum/useMomentumLive";

export default function MomentumPage() {
  const { data, error, isLoading, refetch } = useMomentumLive();

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Momentum</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Intraday momentum strategy: active weekly configuration, risk state and positions (mock data).
          </p>
        </div>
        <button
          onClick={refetch}
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Refresh
        </button>
      </header>

      {error && (
        <p role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </p>
      )}
      {isLoading && !data && <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>}
      {data && (
        <div className="mt-6">
          <MomentumLiveView snapshot={data} now={new Date(data.asOf)} />
        </div>
      )}
    </div>
  );
}
