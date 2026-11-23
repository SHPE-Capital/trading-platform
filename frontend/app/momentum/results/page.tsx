/**
 * app/momentum/results/page.tsx
 *
 * Momentum research results. Runs on mock data until P3-1's API lands: swap
 * `defaultResultsClient` in features/momentum/results/client.ts.
 */

"use client";

import Link from "next/link";
import { MomentumResultsView } from "../../../features/momentum/results/MomentumResultsView";
import { useMomentumResults } from "../../../features/momentum/results/useMomentumResults";

export default function MomentumResultsPage() {
  const { data, error, isLoading } = useMomentumResults();

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Momentum research results</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Similarity, Recency and Uniform policies over the forward period (mock data).{" "}
          <Link href="/momentum" className="underline">Back to live status</Link>
        </p>
      </header>

      {error && (
        <p role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </p>
      )}
      {isLoading && !data && <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>}
      {data && (
        <div className="mt-6">
          <MomentumResultsView summary={data} />
        </div>
      )}
    </div>
  );
}
