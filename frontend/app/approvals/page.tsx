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

import { useState } from "react";
import Link from "next/link";
import { usePendingApprovals, useAllProposals } from "../../hooks/useProposals";
import { useAuth } from "../../context/AuthContext";
import type { ProposalStatus } from "../../types/review";

/** "3 days" / "4 hours" / "12 min" — how long a request has been waiting. */
function waitedFor(since: number): string {
  const mins = Math.max(0, Math.round((Date.now() - since) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.round(hours / 24)} days`;
}

const STATUS_PILL_STYLES: Record<ProposalStatus, string> = {
  open: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-400",
  approved: "border-green-300 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-400",
  rejected: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-400",
  withdrawn: "border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
};

function StatusPill({ status }: { status: ProposalStatus }) {
  return (
    <span className={`rounded border px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_PILL_STYLES[status]}`}>
      {status}
    </span>
  );
}

function ChangesRequestedBadge() {
  return (
    <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
      Changes requested
    </span>
  );
}

export default function ApprovalsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [tab, setTab] = useState<"in_progress" | "all">("in_progress");
  const { approvals, isLoading: pendingLoading, error: pendingError, refetch: refetchPending } = usePendingApprovals();
  const { proposals: allProposals, isLoading: allLoading, error: allError, refetch: refetchAll } = useAllProposals();

  const isLoading = tab === "in_progress" ? pendingLoading : allLoading;
  const error = tab === "in_progress" ? pendingError : allError;
  const refetch = tab === "in_progress" ? refetchPending : refetchAll;

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
              ? "Requests to promote a strategy to live."
              : "Promotion requests. A lead approves them."}
          </p>
        </div>
        <button
          onClick={refetch}
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Refresh
        </button>
      </header>

      <div className="mt-4 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {(["in_progress", "all"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
            }`}
          >
            {t === "in_progress" ? "In progress" : "All"}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </p>
      )}

      {isLoading && (
        <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      )}

      {tab === "in_progress" ? (
        <>
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
                      {a.changesRequested && <ChangesRequestedBadge />}
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
        </>
      ) : (
        <>
          {!isLoading && !error && allProposals.length === 0 && (
            <div className="mt-8 rounded-md border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No proposals yet</p>
            </div>
          )}

          <ul className="mt-6 flex flex-col gap-3">
            {allProposals.map((p) => (
              <li key={p.proposalId}>
                <Link
                  href={`/approvals/${p.proposalId}`}
                  className="block rounded-md border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        {p.title}
                      </h2>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {p.strategyName} · v{p.versionNumber} ·{" "}
                        {p.requestedByName ?? p.requestedByEmail} · opened {waitedFor(p.requestedAt)} ago
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {p.status === "open" && p.changesRequested && <ChangesRequestedBadge />}
                      <StatusPill status={p.status} />
                    </div>
                  </div>

                  {p.status === "approved" && (
                    <p className="mt-2 text-xs text-green-700 dark:text-green-400">
                      Approved by {p.approvedByName ?? "a lead"}
                      {p.approvedCapitalPct != null && ` · sized to ${(p.approvedCapitalPct * 100).toFixed(1)}%`}
                    </p>
                  )}
                  {p.status === "rejected" && p.rejectionReason && (
                    <p className="mt-2 line-clamp-2 text-xs text-red-700 dark:text-red-400">
                      {p.rejectedByName ?? "A lead"}: {p.rejectionReason}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
