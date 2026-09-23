/**
 * adapters/supabase/reviewRepositories.ts
 *
 * Database access for the strategy review workflow — config versions, promotion
 * proposals, and the discussion on them. Kept separate from repositories.ts so
 * that file does not keep growing; both share the same client singleton and the
 * same snake_case ↔ camelCase mapping convention.
 *
 * Inputs:  Domain objects and ids from the controllers.
 * Outputs: Mapped domain types, or null / [] on failure (logged, not thrown,
 *          except where a caller must not proceed — see insert/approve paths).
 */

import { getSupabaseClient } from "./client";
import { logger } from "../../utils/logger";
import type { UUID } from "../../types/common";
import type {
  AppUser,
  StrategyVersion,
  StrategyProposal,
  PendingApproval,
  ProposalSummary,
  ProposalComment,
  TimelineEvent,
  CommentKind,
  ProposalStatus,
} from "../../types/review";

/** Parses a nullable timestamptz column into epoch ms. */
function ms(value: unknown): number {
  return new Date(value as string).getTime();
}
function msOrNull(value: unknown): number | null {
  return value ? new Date(value as string).getTime() : null;
}

// ------------------------------------------------------------------
// Users
// ------------------------------------------------------------------

function mapUser(row: Record<string, unknown>): AppUser {
  return {
    id: row.id as UUID,
    email: row.email as string,
    displayName: (row.display_name as string | null) ?? null,
    role: (row.role as AppUser["role"]) ?? "member",
    createdAt: row.created_at ? ms(row.created_at) : undefined,
  };
}

/** Looks up a club member's profile. Returns null when the row is missing. */
export async function getAppUserById(id: UUID): Promise<AppUser | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("app_users")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    logger.error("getAppUserById failed", { error: error.message });
    return null;
  }
  return data ? mapUser(data as Record<string, unknown>) : null;
}

// ------------------------------------------------------------------
// Versions
// ------------------------------------------------------------------

function mapVersion(row: Record<string, unknown>): StrategyVersion {
  const author = row.app_users as { display_name?: string } | null | undefined;
  return {
    id: row.id as UUID,
    strategyId: row.strategy_id as UUID,
    versionNumber: row.version_number as number,
    config: row.config as StrategyVersion["config"],
    changeSummary: (row.change_summary as string | null) ?? null,
    createdBy: (row.created_by as UUID | null) ?? null,
    createdAt: ms(row.created_at),
    createdByName: author?.display_name ?? null,
  };
}

/**
 * Appends a new immutable version of a strategy's config.
 * version_number is assigned by a database trigger, never by the caller.
 * Throws on failure — the caller must not report success for a lost edit.
 */
export async function insertStrategyVersion(input: {
  strategyId: UUID;
  config: Record<string, unknown>;
  changeSummary?: string | null;
  createdBy: UUID;
}): Promise<StrategyVersion> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("strategy_versions")
    .insert({
      strategy_id: input.strategyId,
      config: input.config,
      change_summary: input.changeSummary ?? null,
      created_by: input.createdBy,
    })
    .select("*")
    .single();
  if (error) {
    logger.error("insertStrategyVersion failed", { error: error.message });
    throw new Error(`insertStrategyVersion failed: ${error.message}`);
  }
  return mapVersion(data as Record<string, unknown>);
}

/** Full version history for one strategy, newest first. */
export async function getStrategyVersions(strategyId: UUID): Promise<StrategyVersion[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("strategy_versions")
    .select("*, app_users:created_by (display_name)")
    .eq("strategy_id", strategyId)
    .order("version_number", { ascending: false });
  if (error) {
    logger.error("getStrategyVersions failed", { error: error.message });
    return [];
  }
  return (data ?? []).map((r) => mapVersion(r as Record<string, unknown>));
}

export async function getStrategyVersionById(id: UUID): Promise<StrategyVersion | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("strategy_versions")
    .select("*, app_users:created_by (display_name)")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    logger.error("getStrategyVersionById failed", { error: error.message });
    return null;
  }
  return data ? mapVersion(data as Record<string, unknown>) : null;
}

/** Most recent version of a strategy, or null if it has none yet. */
export async function getLatestStrategyVersion(strategyId: UUID): Promise<StrategyVersion | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("strategy_versions")
    .select("*")
    .eq("strategy_id", strategyId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.error("getLatestStrategyVersion failed", { error: error.message });
    return null;
  }
  return data ? mapVersion(data as Record<string, unknown>) : null;
}

/** Completed backtests run against one exact version. */
export async function getBacktestsForVersion(versionId: UUID): Promise<Record<string, unknown>[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("backtest_results")
    .select("id, status, metrics, started_at, completed_at, strategy_version_id")
    .eq("strategy_version_id", versionId)
    .order("completed_at", { ascending: false });
  if (error) {
    logger.error("getBacktestsForVersion failed", { error: error.message });
    return [];
  }
  return (data ?? []) as Record<string, unknown>[];
}

/** Tags an existing backtest result with the version it tested. */
export async function linkBacktestToVersion(backtestId: UUID, versionId: UUID): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("backtest_results")
    .update({ strategy_version_id: versionId })
    .eq("id", backtestId);
  if (error) logger.error("linkBacktestToVersion failed", { error: error.message });
}

// ------------------------------------------------------------------
// Proposals
// ------------------------------------------------------------------

function mapProposal(row: Record<string, unknown>): StrategyProposal {
  return {
    id: row.id as UUID,
    strategyId: row.strategy_id as UUID,
    headVersionId: row.head_version_id as UUID,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    status: row.status as ProposalStatus,
    requestedBy: row.requested_by as UUID,
    requestedAt: ms(row.requested_at),
    approvedBy: (row.approved_by as UUID | null) ?? null,
    approvedAt: msOrNull(row.approved_at),
    approvedCapitalPct: (row.approved_capital_pct as number | null) ?? null,
    rejectedBy: (row.rejected_by as UUID | null) ?? null,
    rejectedAt: msOrNull(row.rejected_at),
    rejectionReason: (row.rejection_reason as string | null) ?? null,
    updatedAt: ms(row.updated_at),
  };
}

function mapPendingApproval(row: Record<string, unknown>): PendingApproval {
  return {
    proposalId: row.proposal_id as UUID,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    requestedAt: ms(row.requested_at),
    strategyId: row.strategy_id as UUID,
    strategyName: row.strategy_name as string,
    strategyType: row.strategy_type as PendingApproval["strategyType"],
    headVersionId: row.head_version_id as UUID,
    versionNumber: row.version_number as number,
    proposedConfig: row.proposed_config as PendingApproval["proposedConfig"],
    changeSummary: (row.change_summary as string | null) ?? null,
    versionCreatedAt: ms(row.version_created_at),
    requestedById: row.requested_by_id as UUID,
    requestedByName: (row.requested_by_name as string | null) ?? null,
    requestedByEmail: row.requested_by_email as string,
    backtestCount: Number(row.backtest_count ?? 0),
    latestBacktestAt: msOrNull(row.latest_backtest_at),
    commentCount: Number(row.comment_count ?? 0),
    changesRequested: Boolean(row.changes_requested),
  };
}

function mapProposalSummary(row: Record<string, unknown>): ProposalSummary {
  return {
    proposalId: row.proposal_id as UUID,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    status: row.status as ProposalStatus,
    requestedAt: ms(row.requested_at),
    updatedAt: ms(row.updated_at),
    strategyId: row.strategy_id as UUID,
    strategyName: row.strategy_name as string,
    strategyType: row.strategy_type as ProposalSummary["strategyType"],
    headVersionId: row.head_version_id as UUID,
    versionNumber: row.version_number as number,
    changeSummary: (row.change_summary as string | null) ?? null,
    requestedById: row.requested_by_id as UUID,
    requestedByName: (row.requested_by_name as string | null) ?? null,
    requestedByEmail: row.requested_by_email as string,
    approvedBy: (row.approved_by as UUID | null) ?? null,
    approvedByName: (row.approved_by_name as string | null) ?? null,
    approvedAt: msOrNull(row.approved_at),
    approvedCapitalPct: (row.approved_capital_pct as number | null) ?? null,
    rejectedBy: (row.rejected_by as UUID | null) ?? null,
    rejectedByName: (row.rejected_by_name as string | null) ?? null,
    rejectedAt: msOrNull(row.rejected_at),
    rejectionReason: (row.rejection_reason as string | null) ?? null,
    backtestCount: Number(row.backtest_count ?? 0),
    commentCount: Number(row.comment_count ?? 0),
    changesRequested: Boolean(row.changes_requested),
  };
}

/**
 * Opens a promotion request. A partial unique index allows only one open
 * proposal per strategy, so a duplicate surfaces here as a constraint violation
 * rather than an ambiguous second queue entry.
 */
export async function insertProposal(input: {
  strategyId: UUID;
  headVersionId: UUID;
  title: string;
  description?: string | null;
  requestedBy: UUID;
}): Promise<StrategyProposal> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("strategy_proposals")
    .insert({
      strategy_id: input.strategyId,
      head_version_id: input.headVersionId,
      title: input.title,
      description: input.description ?? null,
      requested_by: input.requestedBy,
    })
    .select("*")
    .single();
  if (error) {
    logger.error("insertProposal failed", { error: error.message });
    throw new Error(`insertProposal failed: ${error.message}`);
  }
  return mapProposal(data as Record<string, unknown>);
}

export async function getProposalById(id: UUID): Promise<StrategyProposal | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("strategy_proposals")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    logger.error("getProposalById failed", { error: error.message });
    return null;
  }
  return data ? mapProposal(data as Record<string, unknown>) : null;
}

/** The single open proposal for a strategy, if one exists. */
export async function getOpenProposalForStrategy(strategyId: UUID): Promise<StrategyProposal | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("strategy_proposals")
    .select("*")
    .eq("strategy_id", strategyId)
    .eq("status", "open")
    .maybeSingle();
  if (error) {
    logger.error("getOpenProposalForStrategy failed", { error: error.message });
    return null;
  }
  return data ? mapProposal(data as Record<string, unknown>) : null;
}

/** The review queue — open proposals with the full context a lead needs. */
export async function listPendingApprovals(): Promise<PendingApproval[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("pending_approvals")
    .select("*")
    .order("requested_at", { ascending: true });
  if (error) {
    logger.error("listPendingApprovals failed", { error: error.message });
    return [];
  }
  return (data ?? []).map((r) => mapPendingApproval(r as Record<string, unknown>));
}

/**
 * Every proposal regardless of status, newest first, optionally filtered —
 * backs the approvals page's "All" tab. Enriched the same way pending_approvals
 * is (strategy name, version, requester), plus who settled it and how.
 */
export async function listProposalSummaries(status?: ProposalStatus): Promise<ProposalSummary[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("proposal_summaries")
    .select("*")
    .order("requested_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) {
    logger.error("listProposalSummaries failed", { error: error.message });
    return [];
  }
  return (data ?? []).map((r) => mapProposalSummary(r as Record<string, unknown>));
}

/**
 * Re-points an open proposal at a newer version. Called when the author pushes
 * a new tested version while review is in progress — the review-page equivalent
 * of new commits landing on an open pull request.
 */
export async function updateProposalHead(
  proposalId: UUID,
  headVersionId: UUID,
): Promise<StrategyProposal | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("strategy_proposals")
    .update({ head_version_id: headVersionId, updated_at: new Date().toISOString() })
    .eq("id", proposalId)
    .eq("status", "open")
    .select("*")
    .maybeSingle();
  if (error) {
    logger.error("updateProposalHead failed", { error: error.message });
    return null;
  }
  return data ? mapProposal(data as Record<string, unknown>) : null;
}

/**
 * Settles a proposal. The status guard lives in the WHERE clause rather than a
 * prior read, so two leads acting at the same moment cannot both succeed — the
 * loser gets zero rows back and the caller returns 409.
 *
 * @returns the updated proposal, or null when it was already settled
 */
export async function settleProposal(
  proposalId: UUID,
  next:
    | { status: "approved"; approvedBy: UUID; approvedCapitalPct?: number | null }
    | { status: "rejected"; rejectedBy: UUID; rejectionReason: string }
    | { status: "withdrawn" },
): Promise<StrategyProposal | null> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();

  const payload: Record<string, unknown> = { status: next.status, updated_at: now };
  if (next.status === "approved") {
    payload.approved_by = next.approvedBy;
    payload.approved_at = now;
    payload.approved_capital_pct = next.approvedCapitalPct ?? null;
  } else if (next.status === "rejected") {
    payload.rejected_by = next.rejectedBy;
    payload.rejected_at = now;
    payload.rejection_reason = next.rejectionReason;
  }

  const { data, error } = await supabase
    .from("strategy_proposals")
    .update(payload)
    .eq("id", proposalId)
    .eq("status", "open")
    .select("*")
    .maybeSingle();

  if (error) {
    logger.error("settleProposal failed", { error: error.message, proposalId });
    throw new Error(`settleProposal failed: ${error.message}`);
  }
  return data ? mapProposal(data as Record<string, unknown>) : null;
}

/** Reverts a proposal to open. Used to roll back when going live fails. */
export async function reopenProposal(proposalId: UUID): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("strategy_proposals")
    .update({
      status: "open",
      approved_by: null,
      approved_at: null,
      approved_capital_pct: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", proposalId);
  if (error) logger.error("reopenProposal failed", { error: error.message, proposalId });
}

// ------------------------------------------------------------------
// Comments
// ------------------------------------------------------------------

function mapComment(row: Record<string, unknown>): ProposalComment {
  const author = row.app_users as { display_name?: string } | null | undefined;
  return {
    id: row.id as UUID,
    proposalId: row.proposal_id as UUID,
    authorId: row.author_id as UUID,
    body: row.body as string,
    kind: row.kind as CommentKind,
    createdAt: ms(row.created_at),
    authorName: author?.display_name ?? null,
  };
}

export async function insertComment(input: {
  proposalId: UUID;
  authorId: UUID;
  body: string;
  kind?: CommentKind;
}): Promise<ProposalComment> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("proposal_comments")
    .insert({
      proposal_id: input.proposalId,
      author_id: input.authorId,
      body: input.body,
      kind: input.kind ?? "comment",
    })
    .select("*")
    .single();
  if (error) {
    logger.error("insertComment failed", { error: error.message });
    throw new Error(`insertComment failed: ${error.message}`);
  }
  return mapComment(data as Record<string, unknown>);
}

export async function getComments(proposalId: UUID): Promise<ProposalComment[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("proposal_comments")
    .select("*, app_users:author_id (display_name)")
    .eq("proposal_id", proposalId)
    .order("created_at", { ascending: true });
  if (error) {
    logger.error("getComments failed", { error: error.message });
    return [];
  }
  return (data ?? []).map((r) => mapComment(r as Record<string, unknown>));
}

// ------------------------------------------------------------------
// Timeline
// ------------------------------------------------------------------

/**
 * The merged proposal history — versions pushed, backtests completed, and
 * comments made — in one chronological list.
 */
export async function getProposalTimeline(proposalId: UUID): Promise<TimelineEvent[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("proposal_timeline")
    .select("*")
    .eq("proposal_id", proposalId)
    .order("occurred_at", { ascending: true });
  if (error) {
    logger.error("getProposalTimeline failed", { error: error.message });
    return [];
  }

  const events = (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      proposalId: r.proposal_id as UUID,
      occurredAt: ms(r.occurred_at),
      kind: r.kind as TimelineEvent["kind"],
      actorId: (r.actor_id as UUID | null) ?? null,
      refId: r.ref_id as UUID,
      payload: (r.payload as Record<string, unknown>) ?? {},
    } as TimelineEvent;
  });

  // Resolve actor names in one round trip rather than per row.
  const actorIds = [...new Set(events.map((e) => e.actorId).filter(Boolean))] as UUID[];
  if (actorIds.length === 0) return events;

  const { data: users } = await supabase
    .from("app_users")
    .select("id, display_name")
    .in("id", actorIds);
  const nameById = new Map(
    (users ?? []).map((u) => [
      (u as { id: string }).id,
      (u as { display_name: string | null }).display_name,
    ]),
  );
  return events.map((e) => ({
    ...e,
    actorName: e.actorId ? nameById.get(e.actorId) ?? null : null,
  }));
}
