/**
 * types/review.ts
 *
 * Frontend mirrors of the backend review-workflow types. Kept in sync by hand,
 * matching the existing convention in types/api.ts and types/strategy.ts.
 *
 * "Version" here is a config revision (v1, v2, v3 of one strategy's settings),
 * not the algorithm's code version.
 */

export type UserRole = "member" | "lead";

/** The signed-in member, as returned by GET /api/auth/me. */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  displayName: string | null;
}

/** One immutable edit of a strategy's config. */
export interface StrategyVersion {
  id: string;
  strategyId: string;
  versionNumber: number;
  config: Record<string, unknown>;
  changeSummary: string | null;
  createdBy: string | null;
  createdAt: number;
  createdByName?: string | null;
  /** Present on the create response: the open proposal this version attached to. */
  attachedToProposalId?: string | null;
}

export type ProposalStatus = "open" | "approved" | "rejected" | "withdrawn";

export interface StrategyProposal {
  id: string;
  strategyId: string;
  headVersionId: string;
  title: string;
  description: string | null;
  status: ProposalStatus;
  requestedBy: string;
  requestedAt: number;
  approvedBy: string | null;
  approvedAt: number | null;
  approvedCapitalPct: number | null;
  rejectedBy: string | null;
  rejectedAt: number | null;
  rejectionReason: string | null;
  updatedAt: number;
}

/** A row of the review queue — enough context to triage without opening it. */
export interface PendingApproval {
  proposalId: string;
  title: string;
  description: string | null;
  requestedAt: number;
  strategyId: string;
  strategyName: string;
  strategyType: string;
  headVersionId: string;
  versionNumber: number;
  proposedConfig: Record<string, unknown>;
  changeSummary: string | null;
  versionCreatedAt: number;
  requestedById: string;
  requestedByName: string | null;
  requestedByEmail: string;
  /** Completed backtests against this exact version. Zero is a red flag. */
  backtestCount: number;
  latestBacktestAt: number | null;
  commentCount: number;
  /** True when feedback (a request_changes comment) postdates the head version. */
  changesRequested: boolean;
}

/** A row of the "All" tab — every proposal regardless of status. */
export interface ProposalSummary {
  proposalId: string;
  title: string;
  description: string | null;
  status: ProposalStatus;
  requestedAt: number;
  updatedAt: number;
  strategyId: string;
  strategyName: string;
  strategyType: string;
  headVersionId: string;
  versionNumber: number;
  changeSummary: string | null;
  requestedById: string;
  requestedByName: string | null;
  requestedByEmail: string;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: number | null;
  approvedCapitalPct: number | null;
  rejectedBy: string | null;
  rejectedByName: string | null;
  rejectedAt: number | null;
  rejectionReason: string | null;
  backtestCount: number;
  commentCount: number;
  changesRequested: boolean;
}

export type CommentKind = "comment" | "suggestion" | "approve" | "request_changes";

export interface ProposalComment {
  id: string;
  proposalId: string;
  authorId: string;
  body: string;
  kind: CommentKind;
  createdAt: number;
  authorName?: string | null;
}

export type TimelineKind = "version" | "backtest" | "comment";

export interface TimelineEvent {
  proposalId: string;
  occurredAt: number;
  kind: TimelineKind;
  actorId: string | null;
  refId: string;
  payload: Record<string, unknown>;
  actorName?: string | null;
}

/** A backtest row as returned alongside a proposal. */
export interface ProposalBacktest {
  id: string;
  status: string;
  metrics: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
  strategy_version_id: string | null;
}

/** What the signed-in member is allowed to do on this proposal. */
export interface ProposalViewer {
  id: string;
  role: UserRole;
  canApprove: boolean;
  canWithdraw: boolean;
}

/** Everything the review page renders, from one request. */
export interface ProposalDetail {
  proposal: StrategyProposal;
  strategy: { id: string; name: string; strategy_type: string } | null;
  headVersion: StrategyVersion | null;
  versions: StrategyVersion[];
  backtests: ProposalBacktest[];
  comments: ProposalComment[];
  timeline: TimelineEvent[];
  viewer: ProposalViewer | null;
}
