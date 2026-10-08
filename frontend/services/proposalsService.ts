/**
 * services/proposalsService.ts
 *
 * Frontend service for the strategy review workflow — versions, proposals,
 * comments, and the approve / reject / withdraw actions.
 *
 * These all target the default API base (the trading process), not the
 * backtest-only process: approving starts a live strategy, so it must reach the
 * runtime that owns the orchestrator.
 */

import { apiGet, apiPost } from "./api";
import { config } from "../config";
import type {
  PendingApproval,
  ProposalComment,
  ProposalDetail,
  ProposalSummary,
  StrategyProposal,
  StrategyVersion,
  CommentKind,
  ProposalStatus,
} from "../types/review";

// ------------------------------------------------------------------
// Versions
// ------------------------------------------------------------------

/** Full config history for one strategy, newest first. */
export async function fetchVersions(strategyId: string): Promise<StrategyVersion[]> {
  return apiGet<StrategyVersion[]>(`/strategies/${strategyId}/versions`);
}

/**
 * Saves an edit as a new immutable version. If the strategy has an open
 * proposal, the response's attachedToProposalId names the proposal this
 * version automatically became the head of.
 */
export async function createVersion(
  strategyId: string,
  config: Record<string, unknown>,
  changeSummary?: string,
): Promise<StrategyVersion> {
  return apiPost<StrategyVersion>(`/strategies/${strategyId}/versions`, { config, changeSummary });
}

// ------------------------------------------------------------------
// Proposals
// ------------------------------------------------------------------

/** The review queue. Omit status for open proposals with full context. */
export async function fetchPendingApprovals(): Promise<PendingApproval[]> {
  return apiGet<PendingApproval[]>("/proposals?status=open");
}

/** Settled proposals of one status, for the history tab. */
export async function fetchProposalsByStatus(status: ProposalStatus): Promise<ProposalSummary[]> {
  return apiGet<ProposalSummary[]>(`/proposals?status=${status}`);
}

/** Every proposal regardless of status, newest first — the "All" tab. */
export async function fetchAllProposals(): Promise<ProposalSummary[]> {
  return apiGet<ProposalSummary[]>("/proposals?status=all");
}

/** Everything the review page renders, in one request. */
export async function fetchProposal(id: string): Promise<ProposalDetail> {
  return apiGet<ProposalDetail>(`/proposals/${id}`);
}

export async function createProposal(input: {
  strategyId: string;
  headVersionId?: string;
  title: string;
  description?: string;
}): Promise<StrategyProposal> {
  return apiPost<StrategyProposal>("/proposals", input);
}

/**
 * Approves and starts the strategy. Lead only.
 * @param approvedCapitalPct - Optional sizing override (0–1). Omit to accept
 *                             the riskBudget the author proposed.
 */
export async function approveProposal(
  id: string,
  expectedHeadVersionId: string,
  approvedCapitalPct?: number,
  note?: string,
): Promise<{ proposal: StrategyProposal; run: { id: string } }> {
  // expectedHeadVersionId pins the approval to the version on screen; the
  // server answers 409 if the author pushed a newer version since it loaded.
  return apiPost(
    `/proposals/${id}/approve`,
    { expectedHeadVersionId, approvedCapitalPct, note },
    config.liveApiBaseUrl,
  );
}

/** Rejects with a required reason. Lead only. */
export async function rejectProposal(id: string, reason: string): Promise<StrategyProposal> {
  return apiPost<StrategyProposal>(`/proposals/${id}/reject`, { reason });
}

/** The author pulling their own request back. */
export async function withdrawProposal(id: string): Promise<StrategyProposal> {
  return apiPost<StrategyProposal>(`/proposals/${id}/withdraw`, {});
}

// ------------------------------------------------------------------
// Comments
// ------------------------------------------------------------------

export async function fetchComments(proposalId: string): Promise<ProposalComment[]> {
  return apiGet<ProposalComment[]>(`/proposals/${proposalId}/comments`);
}

/** Verdict kinds (approve / request_changes) are rejected for non-leads. */
export async function postComment(
  proposalId: string,
  body: string,
  kind: CommentKind = "comment",
): Promise<ProposalComment> {
  return apiPost<ProposalComment>(`/proposals/${proposalId}/comments`, { body, kind });
}
