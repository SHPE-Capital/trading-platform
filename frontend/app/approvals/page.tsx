/**
 * app/approvals/page.tsx
 *
 * The review queue — every open promotion request, oldest first.
 *
 * Each row carries the triage signals a lead needs before opening anything:
 * which version is proposed, who asked, how long it has waited, and how many
 * backtests back it. Zero backtests is called out explicitly, because it is the
 * single strongest reason to send a proposal back.
 */

"use client";

import Link from "next/link";
import { usePendingApprovals } from "../../hooks/useProposals";
import { useAuth } from "../../context/AuthContext";

/** "3 days" / "4 hours" / "12 min" — how long a request has been waiting. */
function waitedFor(since: number): string {
  const mins = Math.max(0, Math.round((Date.now() - since) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.round(hours / 24)} days`;
}

export default function ApprovalsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { approvals, isLoading, error, refetch } = usePendingApprovals();

  if (!authLoading && !user) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <Link href="/login" className="font-medium text-zinc-900 underline dark:text-zinc-50">
            Sign in
          </Link>{" "}
          to see the review queue.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Approvals
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {user?.role === "lead"
              ? "Open requests to promote a strategy to live."
              : "Open requests. A lead approves them."}
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
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </p>
      )}

      {isLoading && (
        <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      )}

      {!isLoading && !error && approvals.length === 0 && (
        <div className="mt-8 rounded-md border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Nothing waiting</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Open a proposal from a strategy once you&apos;ve backtested a version of it.
          </p>
        </div>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {approvals.map((a) => (
          <li key={a.proposalId}>
            <Link
              href={`/approvals/${a.proposalId}`}
              className="block rounded-md border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    {a.title}
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {a.strategyName} · v{a.versionNumber} ·{" "}
                    {a.requestedByName ?? a.requestedByEmail} · waiting {waitedFor(a.requestedAt)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {a.backtestCount === 0 ? (
                    <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
                      No backtest
                    </span>
                  ) : (
                    <span className="rounded border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                      {a.backtestCount} backtest{a.backtestCount === 1 ? "" : "s"}
                    </span>
                  )}
                  {a.commentCount > 0 && (
                    <span className="rounded border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                      {a.commentCount} comment{a.commentCount === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </div>

              {a.changeSummary && (
                <p className="mt-2 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">
                  {a.changeSummary}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
