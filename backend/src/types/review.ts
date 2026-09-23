/**
 * types/review.ts
 *
 * Types for the strategy review workflow: immutable config versions, the
 * promotion proposals that cite them, and the discussion on those proposals.
 *
 * Naming note: "version" here means a config revision (strategy_versions.
 * version_number, 1/2/3...). It is NOT StrategyRun.strategyVersion, which is the
 * algorithm's code version (PairsStrategy.VERSION). Different axes entirely.
 *
 * Inputs:  N/A — type definitions only.
 * Outputs: N/A — type definitions only.
 */

import type { UUID, EpochMs } from "./common";
import type { BaseStrategyConfig, StrategyType } from "./strategy";

// ------------------------------------------------------------------
// Identity
// ------------------------------------------------------------------

/** Club membership role. A lead may approve promotions; a member may not. */
export type UserRole = "member" | "lead";

/** A club member, mirrored from auth.users by the on_auth_user_created trigger. */
export interface AppUser {
  id: UUID;
  email: string;
  displayName: string | null;
  role: UserRole;
  createdAt?: EpochMs;
}

/** The caller identity attached to a request by requireAuth. */
export interface AuthenticatedUser {
  id: UUID;
  email: string;
  role: UserRole;
  displayName: string | null;
}

// ------------------------------------------------------------------
// Versions
// ------------------------------------------------------------------

/**
 * One immutable edit of a strategy's config. Never updated in place — fixing a
 * mistake means creating the next version.
 */
export interface StrategyVersion {
  id: UUID;
  strategyId: UUID;
  /** 1, 2, 3... assigned per strategyId by a database trigger */
  versionNumber: number;
  config: BaseStrategyConfig;
  /** Author's note on what changed and why */
  changeSummary: string | null;
  createdBy: UUID | null;
  createdAt: EpochMs;
  /** Joined for display; not a column */
  createdByName?: string | null;
}

// ------------------------------------------------------------------
// Proposals
// ------------------------------------------------------------------

export type ProposalStatus = "open" | "approved" | "rejected" | "withdrawn";

/** A request to promote one tested version to live. */
export interface StrategyProposal {
  id: UUID;
  strategyId: UUID;
  /** The version currently being proposed; moves forward if the author pushes a newer one */
  headVersionId: UUID;
  title: string;
  description: string | null;
  status: ProposalStatus;

  requestedBy: UUID;
  requestedAt: EpochMs;

  approvedBy: UUID | null;
  approvedAt: EpochMs | null;
  /** Optional sizing override applied to the run's riskBudget.maxCapitalPct */
  approvedCapitalPct: number | null;

  rejectedBy: UUID | null;
  rejectedAt: EpochMs | null;
  rejectionReason: string | null;

  updatedAt: EpochMs;
}

/**
 * A row of the pending_approvals view — everything a lead needs on one screen
 * without four round trips.
 */
export interface PendingApproval {
  proposalId: UUID;
  title: string;
  description: string | null;
  requestedAt: EpochMs;
  strategyId: UUID;
  strategyName: string;
  strategyType: StrategyType;
  headVersionId: UUID;
  versionNumber: number;
  proposedConfig: BaseStrategyConfig;
  changeSummary: string | null;
  versionCreatedAt: EpochMs;
  requestedById: UUID;
  requestedByName: string | null;
  requestedByEmail: string;
  /** Completed backtests run against this exact version. Zero is a red flag. */
  backtestCount: number;
  latestBacktestAt: EpochMs | null;
  commentCount: number;
  /**
   * True when the most recent `request_changes` comment is newer than the head
   * version — i.e. a lead's feedback hasn't been addressed by a new version yet.
   * Clears itself the moment the author pushes one; see 0010.
   */
  changesRequested: boolean;
}

/**
 * A row of the proposal_summaries view — proposal_approvals' superset covering
 * every status, for the approvals page's "All" tab.
 */
export interface ProposalSummary {
  proposalId: UUID;
  title: string;
  description: string | null;
  status: ProposalStatus;
  requestedAt: EpochMs;
  updatedAt: EpochMs;
  strategyId: UUID;
  strategyName: string;
  strategyType: StrategyType;
  headVersionId: UUID;
  versionNumber: number;
  changeSummary: string | null;
  requestedById: UUID;
  requestedByName: string | null;
  requestedByEmail: string;
  approvedBy: UUID | null;
  approvedByName: string | null;
  approvedAt: EpochMs | null;
  approvedCapitalPct: number | null;
  rejectedBy: UUID | null;
  rejectedByName: string | null;
  rejectedAt: EpochMs | null;
  rejectionReason: string | null;
  backtestCount: number;
  commentCount: number;
  changesRequested: boolean;
}

/**
 * What approving would add to the book: every live run's capital cap in the
 * same execution mode, summed, next to the cap this proposal asks for. Caps are
 * ceilings (riskBudget.maxCapitalPct), not current usage — the point is to see
 * whether the club is about to promise out more of the book than it has.
 */
export interface CapitalExposure {
  executionMode: string;
  /** Current book equity when the serving process holds the live portfolio. */
  bookEquity: number | null;
  liveRuns: {
    runId: UUID;
    name: string;
    ownerName: string | null;
    /** Null = no cap: the run may use whatever capital the club limits allow. */
    maxCapitalPct: number | null;
  }[];
  /** Sum of the capped runs' maxCapitalPct. */
  allocatedPct: number;
  /** Live runs with no cap — they make the total a lower bound. */
  uncappedRuns: number;
  /** The head version's requested cap, or null if it has none. */
  proposedPct: number | null;
}

// ------------------------------------------------------------------
// Discussion
// ------------------------------------------------------------------

/**
 * A lead's approve / request-changes verdict is a comment with a kind, rather
 * than a separate reviews table — so one ordered query rebuilds the whole thread.
 */
export type CommentKind = "comment" | "suggestion" | "approve" | "request_changes";

export interface ProposalComment {
  id: UUID;
  proposalId: UUID;
  authorId: UUID;
  body: string;
  kind: CommentKind;
  createdAt: EpochMs;
  /** Joined for display; not a column */
  authorName?: string | null;
}

// ------------------------------------------------------------------
// Timeline
// ------------------------------------------------------------------

/** What kind of thing happened on a proposal at a point in time. */
export type TimelineKind = "version" | "backtest" | "comment";

/**
 * One entry in the merged proposal history. Versions, backtests and comments
 * are separate typed tables unioned by the proposal_timeline view.
 */
export interface TimelineEvent {
  proposalId: UUID;
  occurredAt: EpochMs;
  kind: TimelineKind;
  actorId: UUID | null;
  /** Id of the version / backtest / comment this entry describes */
  refId: UUID;
  payload: Record<string, unknown>;
  /** Joined for display; not a column */
  actorName?: string | null;
}

// ------------------------------------------------------------------
// Request payloads
// ------------------------------------------------------------------

export interface CreateVersionInput {
  strategyId: UUID;
  config: Record<string, unknown>;
  changeSummary?: string;
}

export interface CreateProposalInput {
  strategyId: UUID;
  headVersionId: UUID;
  title: string;
  description?: string;
}

export interface ApproveProposalInput {
  /** Sizing override, 0–1. Omit to accept the config's own riskBudget as proposed. */
  approvedCapitalPct?: number;
  /** Optional note recorded as an `approve` comment on the thread */
  note?: string;
}

export interface RejectProposalInput {
  reason: string;
}
