/**
 * app/approvals/[id]/page.tsx
 *
 * The review page for one promotion request — the pull-request analogue.
 *
 * Read and discuss only: there is no way to edit the strategy from here. That's
 * deliberate. Changing a strategy means creating and backtesting a new version,
 * which then attaches to this proposal automatically, the way new commits land
 * on an open PR.
 */

"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useProposal } from "../../../hooks/useProposals";
import { useAuth } from "../../../context/AuthContext";
import ConfigDiffView from "../../../features/approvals/ConfigDiffView";
import CapitalExposurePanel from "../../../features/approvals/CapitalExposurePanel";
import type { ProposalStatus, TimelineEvent, CommentKind } from "../../../types/review";

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<ProposalStatus, string> = {
  open: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-400",
  approved: "border-green-300 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-400",
  rejected: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-400",
  withdrawn: "border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
};

function StatusBadge({ status }: { status: ProposalStatus }) {
  return (
    <span className={`rounded border px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

function when(ts: number): string {
  return new Date(ts).toLocaleString();
}

/** Renders one timeline entry — version pushed, backtest finished, or comment. */
function TimelineRow({ event }: { event: TimelineEvent }) {
  const actor = event.actorName ?? "Someone";

  if (event.kind === "version") {
    const p = event.payload as { version_number?: number; change_summary?: string; is_head?: boolean };
    return (
      <li className="relative pl-6">
        <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-zinc-400" />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{actor}</span> pushed{" "}
          <span className="font-mono">v{p.version_number}</span>
          {p.is_head && (
            <span className="ml-2 rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] dark:border-zinc-600">
              current
            </span>
          )}
          <span className="ml-2">{when(event.occurredAt)}</span>
        </p>
        {p.change_summary && (
          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{p.change_summary}</p>
        )}
      </li>
    );
  }

  if (event.kind === "backtest") {
    const p = event.payload as { status?: string; metrics?: Record<string, unknown> | null };
    const ret = p.metrics?.totalReturnPct ?? p.metrics?.totalReturn;
    return (
      <li className="relative pl-6">
        <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-emerald-500" />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Backtest {p.status}
          {typeof ret === "number" && (
            <span className="ml-2 font-mono text-zinc-700 dark:text-zinc-300">
              {(ret * 100).toFixed(2)}%
            </span>
          )}
          <span className="ml-2">{when(event.occurredAt)}</span>
        </p>
      </li>
    );
  }

  const p = event.payload as { body?: string; kind?: CommentKind };
  const isVerdict = p.kind === "approve" || p.kind === "request_changes";
  return (
    <li className="relative pl-6">
      <span
        className={`absolute left-0 top-1.5 h-2 w-2 rounded-full ${
          p.kind === "approve" ? "bg-green-500" : p.kind === "request_changes" ? "bg-amber-500" : "bg-zinc-300"
        }`}
      />
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">{actor}</span>
        {isVerdict ? (p.kind === "approve" ? " approved" : " requested changes") : " commented"}
        <span className="ml-2">{when(event.occurredAt)}</span>
      </p>
      {p.body && (
        <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">{p.body}</p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const { detail, isLoading, error, isActing, actionError, approve, reject, withdraw, comment } =
    useProposal(id);

  const [commentBody, setCommentBody] = useState("");
  const [changesText, setChangesText] = useState("");
  const [showRequestChanges, setShowRequestChanges] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [capitalOverride, setCapitalOverride] = useState("");
  /** Version the head is diffed against; null = the one just before the head. */
  const [compareToId, setCompareToId] = useState<string | null>(null);

  if (isLoading) {
    return <p className="mx-auto max-w-4xl px-6 py-10 text-sm text-zinc-500">Loading…</p>;
  }
  if (error || !detail) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-sm text-red-600 dark:text-red-400">{error ?? "Proposal not found"}</p>
        <Link href="/approvals" className="mt-3 inline-block text-sm text-zinc-600 underline dark:text-zinc-400">
          Back to approvals
        </Link>
      </div>
    );
  }

  const { proposal, strategy, headVersion, versions, backtests, comments, timeline, viewer, capitalExposure } = detail;
  const budget = headVersion?.config?.riskBudget as { maxCapitalPct?: number } | undefined;
  const proposedPct = budget?.maxCapitalPct;
  const overridePct = capitalOverride.trim() === "" ? null : Number(capitalOverride) / 100;

  // Diff base: the version the reviewer picked, else the one right before the head.
  const previousVersion = headVersion
    ? versions
        .filter((v) => v.versionNumber < headVersion.versionNumber)
        .sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null
    : null;
  const baseVersion = (compareToId && versions.find((v) => v.id === compareToId)) || previousVersion;

  // True when a lead's feedback postdates the current head version — i.e. the
  // author hasn't pushed a fix for it yet. Clears itself the moment they do,
  // since a new version moves headVersion.createdAt past the comment. See 0010.
  const changesRequested =
    proposal.status === "open" &&
    headVersion != null &&
    comments.some((c) => c.kind === "request_changes" && c.createdAt >= headVersion.createdAt);

  const handleApprove = async () => {
    const pct = capitalOverride.trim() === "" ? undefined : Number(capitalOverride) / 100;
    await approve(pct);
  };

  const handleRequestChanges = async () => {
    if (!changesText.trim()) return;
    await comment(changesText, "request_changes");
    setChangesText("");
    setShowRequestChanges(false);
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/approvals" className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
        ← Approvals
      </Link>

      {/* ---------- header ---------- */}
      <header className="mt-3 border-b border-zinc-200 pb-5 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {proposal.title}
          </h1>
          <StatusBadge status={proposal.status} />
        </div>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {strategy?.name ?? "Strategy"} · proposing{" "}
          <span className="font-mono text-zinc-700 dark:text-zinc-300">
            v{headVersion?.versionNumber}
          </span>{" "}
          · opened {when(proposal.requestedAt)}
        </p>
        {proposal.description && (
          <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
            {proposal.description}
          </p>
        )}
        {changesRequested && (
          <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
            <span className="font-medium">Changes requested.</span> Push a new version of the
            strategy addressing the feedback below — it re-attaches here automatically.
          </p>
        )}
        {proposal.status === "rejected" && proposal.rejectionReason && (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            <span className="font-medium">Rejected:</span> {proposal.rejectionReason}
          </p>
        )}
        {proposal.status === "approved" && (
          <p className="mt-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-400">
            Approved {proposal.approvedAt ? when(proposal.approvedAt) : ""}
            {proposal.approvedCapitalPct != null && (
              <> · sized to {(proposal.approvedCapitalPct * 100).toFixed(1)}% of book</>
            )}
          </p>
        )}
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* ---------- main column ---------- */}
        <div className="min-w-0">
          {/* evidence */}
          <section>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Backtests for v{headVersion?.versionNumber}
            </h2>
            {backtests.length === 0 ? (
              <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
                No completed backtest has been run against this exact version. That&apos;s usually a
                reason to request changes rather than approve.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {backtests.map((b) => {
                  const m = (b.metrics ?? {}) as Record<string, number | undefined>;
                  return (
                    <li
                      key={b.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <span className="font-mono text-zinc-600 dark:text-zinc-400">
                        {b.completed_at ? new Date(b.completed_at).toLocaleDateString() : "—"}
                      </span>
                      <span className="flex gap-4 font-mono text-zinc-700 dark:text-zinc-300">
                        {m.totalReturnPct != null && <span>ret {(m.totalReturnPct * 100).toFixed(2)}%</span>}
                        {m.sharpeRatio != null && <span>sharpe {m.sharpeRatio.toFixed(2)}</span>}
                        {m.maxDrawdownPct != null && <span>dd {(m.maxDrawdownPct * 100).toFixed(1)}%</span>}
                      </span>
                      <Link href={`/backtest?id=${b.id}`} className="text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200">
                        Open
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* what changed */}
          {headVersion && (
            <section className="mt-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Changes in v{headVersion.versionNumber}
                  {baseVersion && (
                    <>
                      {" "}
                      <span className="font-normal text-zinc-500">vs v{baseVersion.versionNumber}</span>
                    </>
                  )}
                </h2>
                {compareToId && (
                  <button
                    onClick={() => setCompareToId(null)}
                    className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    Compare with previous version
                  </button>
                )}
              </div>
              {headVersion.changeSummary && (
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{headVersion.changeSummary}</p>
              )}
              <div className="mt-2">
                <ConfigDiffView
                  before={(baseVersion?.config as Record<string, unknown> | undefined) ?? null}
                  after={headVersion.config as Record<string, unknown>}
                  beforeLabel={baseVersion ? `v${baseVersion.versionNumber}` : "—"}
                  afterLabel={`v${headVersion.versionNumber}`}
                />
              </div>
            </section>
          )}

          {/* proposed config */}
          <section className="mt-6">
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Full proposed config
              </summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-md border border-zinc-200 bg-white p-3 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
{JSON.stringify(headVersion?.config ?? {}, null, 2)}
              </pre>
            </details>
          </section>

          {/* timeline */}
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Activity</h2>
            <ul className="mt-3 flex flex-col gap-4 border-l border-zinc-200 pl-1 dark:border-zinc-800">
              {timeline.map((e) => (
                <TimelineRow key={`${e.kind}-${e.refId}-${e.occurredAt}`} event={e} />
              ))}
              {timeline.length === 0 && (
                <li className="pl-6 text-sm text-zinc-500 dark:text-zinc-400">Nothing yet.</li>
              )}
            </ul>
          </section>

          {/* comment box */}
          {user && proposal.status === "open" && (
            <section className="mt-6">
              <label htmlFor="comment-body" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Leave a comment
              </label>
              <textarea
                id="comment-body"
                rows={3}
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Ask a question, or suggest a change for the next version…"
                className="mt-2 w-full rounded-md border border-zinc-200 bg-white p-3 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
              <div className="mt-2 flex gap-2">
                <button
                  disabled={isActing || !commentBody.trim()}
                  onClick={async () => { await comment(commentBody, "comment"); setCommentBody(""); }}
                  className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Comment
                </button>
                <button
                  disabled={isActing || !commentBody.trim()}
                  onClick={async () => { await comment(commentBody, "suggestion"); setCommentBody(""); }}
                  className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Suggest
                </button>
              </div>
            </section>
          )}
        </div>

        {/* ---------- sidebar ---------- */}
        <aside className="flex flex-col gap-4">
          <div className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Versions</h3>
            <ul className="mt-2 flex flex-col gap-1 text-xs">
              {versions.map((v) => {
                const isHead = v.id === proposal.headVersionId;
                const isBase = v.id === baseVersion?.id;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      disabled={isHead}
                      onClick={() => setCompareToId(v.id)}
                      title={isHead ? "The version being proposed" : `Diff v${headVersion?.versionNumber} against this version`}
                      className={`flex w-full items-center justify-between rounded px-1 py-0.5 text-left ${
                        isHead
                          ? "font-medium text-zinc-900 dark:text-zinc-50"
                          : "text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      } ${isBase ? "ring-1 ring-zinc-300 dark:ring-zinc-600" : ""}`}
                    >
                      <span className="font-mono">
                        v{v.versionNumber}
                        {isHead && <span className="ml-1 font-sans text-[10px] text-zinc-400">proposed</span>}
                        {isBase && <span className="ml-1 font-sans text-[10px] text-zinc-400">compared</span>}
                      </span>
                      <span className="truncate pl-2">{v.createdByName ?? "—"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {capitalExposure && (
            <CapitalExposurePanel
              exposure={capitalExposure}
              overridePct={overridePct !== null && Number.isFinite(overridePct) && overridePct > 0 ? overridePct : null}
            />
          )}

          {actionError && (
            <p className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
              {actionError}
            </p>
          )}

          {viewer?.canApprove && (
            <div className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Decision</h3>

              <label htmlFor="capital-pct" className="mt-3 block text-xs text-zinc-600 dark:text-zinc-400">
                Capital allocation (% of book)
              </label>
              <input
                id="capital-pct"
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                value={capitalOverride}
                onChange={(e) => setCapitalOverride(e.target.value)}
                placeholder={proposedPct != null ? (proposedPct * 100).toFixed(1) : "as proposed"}
                className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
              <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                {proposedPct != null
                  ? `Author proposed ${(proposedPct * 100).toFixed(1)}%. Leave blank to accept.`
                  : "Leave blank to accept the config as written."}
              </p>

              <button
                disabled={isActing}
                onClick={handleApprove}
                className="mt-3 w-full rounded-md bg-green-700 px-3 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50"
              >
                {isActing ? "Working…" : "Approve & start"}
              </button>

              {/* Soft: stays open, just posts feedback. The author pushes a new
                  version to address it — that re-attaches here automatically. */}
              {!showRequestChanges ? (
                <button
                  disabled={isActing}
                  onClick={() => setShowRequestChanges(true)}
                  className="mt-2 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Request changes
                </button>
              ) : (
                <div className="mt-2">
                  <textarea
                    id="changes-text"
                    rows={3}
                    value={changesText}
                    onChange={(e) => setChangesText(e.target.value)}
                    placeholder="What needs to change? The proposal stays open."
                    className="w-full rounded-md border border-zinc-200 bg-white p-2 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      disabled={isActing || !changesText.trim()}
                      onClick={handleRequestChanges}
                      className="flex-1 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
                    >
                      Send feedback
                    </button>
                    <button
                      disabled={isActing}
                      onClick={() => { setShowRequestChanges(false); setChangesText(""); }}
                      className="rounded-md px-3 py-2 text-sm text-zinc-500 hover:text-zinc-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Terminal: closes the proposal. A new version won't reattach —
                  the author has to open a fresh proposal. Kept separate and
                  understated so it isn't reached for by accident. */}
              {!showReject ? (
                <button
                  disabled={isActing}
                  onClick={() => setShowReject(true)}
                  className="mt-4 w-full text-xs text-zinc-400 hover:text-red-600 disabled:opacity-50 dark:text-zinc-500 dark:hover:text-red-400"
                >
                  Reject this proposal
                </button>
              ) : (
                <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Closes the proposal for good — a new version won&apos;t reattach.
                  </p>
                  <textarea
                    id="reject-reason"
                    rows={3}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Why is this being rejected outright?"
                    className="mt-2 w-full rounded-md border border-zinc-200 bg-white p-2 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      disabled={isActing || !rejectReason.trim()}
                      onClick={() => reject(rejectReason)}
                      className="flex-1 rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      disabled={isActing}
                      onClick={() => { setShowReject(false); setRejectReason(""); }}
                      className="rounded-md px-3 py-2 text-sm text-zinc-500 hover:text-zinc-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {viewer?.canWithdraw && (
            <button
              disabled={isActing}
              onClick={withdraw}
              className="rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Withdraw proposal
            </button>
          )}

          {proposal.status === "open" && !viewer?.canApprove && (
            <p className="rounded-md border border-zinc-200 p-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              A lead approves promotions. To change this proposal, save a new version of the
              strategy and backtest it — it attaches here automatically.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
