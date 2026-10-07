/**
 * app/controllers/proposalsController.ts
 *
 * The strategy review workflow: config versions, promotion proposals, the
 * discussion on them, and the approval that actually puts a strategy live.
 *
 * Shape of the flow — a strategy is authored and backtested outside review;
 * a proposal cites one already-tested version; the review page is discussion
 * only; addressing feedback means creating the next tested version, which
 * re-points the open proposal. Approval is the single moment anything goes live.
 *
 * Inputs:  HTTP requests from the strategies / approvals views.
 * Outputs: JSON version, proposal, comment and timeline records.
 */

import type { Request, Response } from "express";
import { insertRunEvent } from "../../adapters/supabase/analyticsRepository";
import { allocatedCapital } from "../../core/analytics/runPerformance";
import {
  insertStrategyVersion,
  getStrategyVersions,
  getStrategyVersionById,
  getLatestStrategyVersion,
  getBacktestsForVersion,
  insertProposal,
  getProposalById,
  getOpenProposalForStrategy,
  listPendingApprovals,
  listProposalSummaries,
  updateProposalHead,
  settleProposal,
  reopenProposal,
  insertComment,
  getComments,
  getProposalTimeline,
  getAppUsersByIds,
} from "../../adapters/supabase/reviewRepositories";
import {
  getStrategyById,
  getRunningRuns,
  insertStrategyRun,
  updateStrategy,
  StrategyAlreadyLiveError,
} from "../../adapters/supabase/repositories";
import { STRATEGY_DEFINITIONS, STRATEGY_FACTORY } from "../../config/strategyDefaults";
import { env } from "../../config/env";
import { newId } from "../../utils/ids";
import { nowMs } from "../../utils/time";
import { logger } from "../../utils/logger";
import type { AppContext } from "../context";
import type { StrategyRun, StrategyType } from "../../types/strategy";
import type { UUID } from "../../types/common";
import type { CapitalExposure, CommentKind, ProposalStatus } from "../../types/review";

/** Statuses a caller may filter the proposal list by. */
const VALID_STATUSES: ProposalStatus[] = ["open", "approved", "rejected", "withdrawn"];
/** Non-status query values the list endpoint also accepts. */
const ALL_STATUSES = "all";

// ------------------------------------------------------------------
// Versions
// ------------------------------------------------------------------

/**
 * GET /api/strategies/:strategyId/versions
 * Full config history for a strategy, newest first.
 */
export async function listVersions(req: Request, res: Response): Promise<void> {
  const strategyId = String(req.params.strategyId);
  try {
    const versions = await getStrategyVersions(strategyId);
    res.json(versions);
  } catch (err) {
    logger.error("listVersions error", { strategyId, err });
    res.status(500).json({ error: "Failed to fetch strategy versions" });
  }
}

/**
 * POST /api/strategies/:strategyId/versions
 * Body: { config, changeSummary? }
 *
 * Appends an immutable version. If the strategy already has an open proposal,
 * the new version becomes its head automatically — the review-page equivalent of
 * pushing a commit to an open pull request, which is why the author never edits
 * from the review page itself.
 */
export async function createVersion(req: Request, res: Response): Promise<void> {
  const strategyId = String(req.params.strategyId);
  const { config, changeSummary } = req.body as {
    config?: Record<string, unknown>;
    changeSummary?: string;
  };

  if (!config || typeof config !== "object") {
    res.status(400).json({ error: "config is required" });
    return;
  }

  const strategy = await getStrategyById(strategyId);
  if (!strategy) {
    res.status(404).json({ error: `Strategy ${strategyId} not found` });
    return;
  }
  if (req.user!.role !== "lead" && strategy.owner_id !== req.user!.id) {
    res.status(403).json({ error: "Only the strategy owner or a lead may create a version" });
    return;
  }

  try {
    const version = await insertStrategyVersion({
      strategyId,
      config,
      changeSummary: changeSummary ?? null,
      createdBy: req.user!.id,
    });

    // Keep strategies.config pointing at the newest version so every existing
    // reader (the strategy form, the backtest form) sees the latest without
    // knowing versions exist.
    await updateStrategy(strategyId, strategy.name, config);

    const open = await getOpenProposalForStrategy(strategyId);
    let attachedToProposalId: UUID | null = null;
    if (open) {
      const updated = await updateProposalHead(open.id, version.id);
      if (updated) {
        attachedToProposalId = updated.id;
        logger.info("createVersion: attached new version to open proposal", {
          proposalId: updated.id,
          versionId: version.id,
          versionNumber: version.versionNumber,
        });
      }
    }

    res.status(201).json({ ...version, attachedToProposalId });
  } catch (err) {
    logger.error("createVersion error", { strategyId, err });
    res.status(500).json({ error: "Failed to create strategy version" });
  }
}

// ------------------------------------------------------------------
// Proposals
// ------------------------------------------------------------------

/**
 * GET /api/proposals?status=open|approved|rejected|withdrawn|all
 * "open" (or omitted) returns the enriched review-queue rows, oldest first —
 * what a lead triages. "all" and every other status return the fuller
 * proposal_summaries rows, newest first, for the approvals page's history tab.
 */
export async function listProposalsHandler(req: Request, res: Response): Promise<void> {
  const status = req.query.status as ProposalStatus | typeof ALL_STATUSES | undefined;
  if (status && status !== ALL_STATUSES && !VALID_STATUSES.includes(status)) {
    res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(", ")}, or ${ALL_STATUSES}` });
    return;
  }
  try {
    if (!status || status === "open") {
      const pending = await listPendingApprovals();
      res.json(pending);
      return;
    }
    res.json(await listProposalSummaries(status === ALL_STATUSES ? undefined : status));
  } catch (err) {
    logger.error("listProposals error", { err });
    res.status(500).json({ error: "Failed to fetch proposals" });
  }
}

function capitalPctOf(config: Record<string, unknown> | undefined | null): number | null {
  const pct = (config?.riskBudget as { maxCapitalPct?: unknown } | undefined)?.maxCapitalPct;
  return typeof pct === "number" && pct > 0 ? pct : null;
}

/**
 * Sums the capital caps of every live run in this book next to the cap the
 * proposal requests, so a lead sees what approving adds to the total. Reads the
 * database rather than this process's orchestrator: runs may be leased to a
 * different runner of the same mode.
 */
async function buildCapitalExposure(
  ctx: AppContext,
  proposedConfig: Record<string, unknown> | undefined,
): Promise<CapitalExposure> {
  const executionMode = ctx.executionMode ?? "paper";
  const runs = await getRunningRuns(executionMode);
  const owners = await getAppUsersByIds([...new Set(runs.map((r) => r.ownerId).filter((v): v is string => !!v))]);
  const ownerName = new Map(owners.map((u) => [u.id, u.displayName ?? u.email]));

  const liveRuns = runs.map((r) => ({
    runId: r.id,
    name: r.name,
    ownerName: r.ownerId ? ownerName.get(r.ownerId) ?? null : null,
    maxCapitalPct: capitalPctOf(r.config as unknown as Record<string, unknown>),
  }));
  return {
    executionMode,
    bookEquity: ctx.portfolioState?.getSnapshot().equity ?? null,
    liveRuns,
    allocatedPct: liveRuns.reduce((sum, r) => sum + (r.maxCapitalPct ?? 0), 0),
    uncappedRuns: liveRuns.filter((r) => r.maxCapitalPct === null).length,
    proposedPct: capitalPctOf(proposedConfig),
  };
}

/**
 * GET /api/proposals/:id
 * Everything the review page needs in one response: the proposal, the version
 * it points at, the backtests run against that exact version, the comment
 * thread, and the merged timeline.
 */
export async function getProposalDetail(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  try {
    const proposal = await getProposalById(id);
    if (!proposal) {
      res.status(404).json({ error: `Proposal ${id} not found` });
      return;
    }

    const [headVersion, versions, comments, timeline, strategy] = await Promise.all([
      getStrategyVersionById(proposal.headVersionId),
      getStrategyVersions(proposal.strategyId),
      getComments(id),
      getProposalTimeline(id),
      getStrategyById(proposal.strategyId),
    ]);

    const ctx = (req.app.locals.ctx ?? {}) as AppContext;
    const [backtests, capitalExposure] = await Promise.all([
      getBacktestsForVersion(proposal.headVersionId),
      // Only worth computing while there is still a decision to make.
      proposal.status === "open"
        ? buildCapitalExposure(ctx, headVersion?.config as unknown as Record<string, unknown> | undefined)
            .catch((err) => {
              logger.warn("getProposalDetail: capital exposure unavailable", { id, err: String(err) });
              return null;
            })
        : Promise.resolve(null),
    ]);

    res.json({
      proposal,
      strategy,
      headVersion,
      versions,
      backtests,
      comments,
      timeline,
      capitalExposure,
      // Lets the UI decide what to render without duplicating the role rules.
      viewer: req.user
        ? {
            id: req.user.id,
            role: req.user.role,
            canApprove: req.user.role === "lead" && proposal.status === "open",
            canWithdraw: req.user.id === proposal.requestedBy && proposal.status === "open",
          }
        : null,
    });
  } catch (err) {
    logger.error("getProposalDetail error", { id, err });
    res.status(500).json({ error: "Failed to fetch proposal" });
  }
}

/**
 * POST /api/proposals
 * Body: { strategyId, headVersionId?, title, description? }
 *
 * Opens a promotion request. headVersionId defaults to the strategy's newest
 * version. Only one proposal may be open per strategy at a time.
 */
export async function createProposal(req: Request, res: Response): Promise<void> {
  const { strategyId, headVersionId, title, description } = req.body as {
    strategyId?: string;
    headVersionId?: string;
    title?: string;
    description?: string;
  };

  if (!strategyId || !title) {
    res.status(400).json({ error: "strategyId and title are required" });
    return;
  }

  const existing = await getOpenProposalForStrategy(strategyId);
  if (existing) {
    res.status(409).json({
      error: "This strategy already has an open proposal",
      detail: "Push a new version instead — it attaches to the open proposal automatically.",
      proposalId: existing.id,
    });
    return;
  }

  // Default to the newest version so the common path needs no id from the client.
  let versionId = headVersionId;
  if (!versionId) {
    const latest = await getLatestStrategyVersion(strategyId);
    if (!latest) {
      res.status(400).json({
        error: "This strategy has no versions yet",
        detail: "Save an edit first — every version is what a proposal cites.",
      });
      return;
    }
    versionId = latest.id;
  }

  const version = await getStrategyVersionById(versionId);
  if (!version || version.strategyId !== strategyId) {
    res.status(400).json({ error: "headVersionId does not belong to this strategy" });
    return;
  }

  try {
    const proposal = await insertProposal({
      strategyId,
      headVersionId: versionId,
      title,
      description: description ?? null,
      requestedBy: req.user!.id,
    });
    logger.info("createProposal: opened", { proposalId: proposal.id, strategyId });
    res.status(201).json(proposal);
  } catch (err) {
    logger.error("createProposal error", { strategyId, err });
    res.status(500).json({ error: "Failed to open proposal" });
  }
}

/**
 * Splits a version's saved backtests into those that may justify a real-money
 * promotion and those that may not, with the reason for each rejection.
 *
 * A backtest qualifies only when it completed, ran the algorithm version that
 * this runtime will trade (a VERSION bump since the run means the evidence is
 * for different code), came from this runtime's origin, and — whenever this
 * runtime itself is a clean build — came from a clean build too. Local dirty
 * runtimes may approve local dirty evidence so the workflow stays testable.
 */
export function selectPromotionEvidence(
  rows: Record<string, unknown>[],
  algorithmVersion: number | undefined,
  runtime: { origin: string; dirty: boolean } = { origin: env.runtimeOrigin, dirty: env.buildDirty },
): { qualifying: Record<string, unknown>[]; rejected: { id: unknown; reason: string }[] } {
  const qualifying: Record<string, unknown>[] = [];
  const rejected: { id: unknown; reason: string }[] = [];
  for (const row of rows) {
    let reason: string | null = null;
    if (row.status !== "completed") {
      reason = `status is ${String(row.status)}, not completed`;
    } else if (algorithmVersion !== undefined && Number(row.strategy_version) !== algorithmVersion) {
      reason = `ran algorithm v${String(row.strategy_version)}, but v${algorithmVersion} is deployed`;
    } else if (row.runtime_origin !== runtime.origin) {
      reason = `ran in the ${String(row.runtime_origin)} environment, not ${runtime.origin}`;
    } else if (!runtime.dirty && row.build_dirty !== false) {
      reason = `ran on an uncommitted build (${String(row.build_sha)})`;
    }
    if (reason) rejected.push({ id: row.id, reason });
    else qualifying.push(row);
  }
  return { qualifying, rejected };
}

/**
 * POST /api/proposals/:id/approve  (lead only)
 * Body: { expectedHeadVersionId, approvedCapitalPct?, note? }
 *
 * expectedHeadVersionId is the version the lead was looking at. Any member
 * push re-points an open proposal's head, so approving "whatever the head is
 * now" could promote a version nobody reviewed.
 *
 * The only path that puts a strategy live. Settles the proposal first — a
 * guarded update that two simultaneous approvals cannot both win — then builds
 * the strategy from the cited version's persisted config, warms it from
 * history, writes the single strategy_runs row already leased to this runner,
 * and only then starts trading it. A failure before the row lands rolls the
 * proposal back to open so the queue stays truthful.
 */
export async function approveProposal(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const { expectedHeadVersionId, approvedCapitalPct, note } = req.body as {
    expectedHeadVersionId?: string;
    approvedCapitalPct?: number;
    note?: string;
  };

  if (typeof expectedHeadVersionId !== "string" || expectedHeadVersionId.length === 0) {
    res.status(400).json({
      error: "expectedHeadVersionId is required",
      detail: "Approval must name the exact strategy version that was reviewed.",
    });
    return;
  }

  if (
    approvedCapitalPct !== undefined &&
    (typeof approvedCapitalPct !== "number" || approvedCapitalPct <= 0 || approvedCapitalPct > 1)
  ) {
    res.status(400).json({ error: "approvedCapitalPct must be between 0 (exclusive) and 1" });
    return;
  }

  const { orchestrator, liveRuns, executionMode, portfolioState } = req.app.locals.ctx as AppContext;
  if (!orchestrator || !liveRuns) {
    res.status(503).json({
      error: "Orchestrator not available in this runtime mode",
      detail: "Approving starts a live strategy, so it must run against the trading process.",
    });
    return;
  }
  if (executionMode !== "live") {
    res.status(403).json({
      error: "Lead approval is reserved for real-money promotion",
      detail: "Active members can start an immutable version directly in the paper sandbox.",
    });
    return;
  }

  const proposal = await getProposalById(id);
  if (!proposal) {
    res.status(404).json({ error: `Proposal ${id} not found` });
    return;
  }
  if (proposal.status !== "open") {
    res.status(409).json({ error: `Proposal is already ${proposal.status}` });
    return;
  }

  if (proposal.headVersionId !== expectedHeadVersionId) {
    res.status(409).json({
      error: "The proposal moved to a newer version after you loaded it",
      detail: "Reload the review page, review the latest version and its backtests, then approve again.",
      headVersionId: proposal.headVersionId,
    });
    return;
  }

  const version = await getStrategyVersionById(proposal.headVersionId);
  if (!version) {
    res.status(409).json({ error: "The proposed version no longer exists" });
    return;
  }

  const strategyType = version.config.type as StrategyType | undefined;
  const factory = strategyType ? STRATEGY_FACTORY[strategyType] : undefined;
  if (!factory) {
    res.status(400).json({ error: `Unknown strategy type: ${strategyType}` });
    return;
  }

  const evidence = selectPromotionEvidence(
    await getBacktestsForVersion(proposal.headVersionId),
    STRATEGY_DEFINITIONS[strategyType as string]?.algorithmVersion,
  );
  if (evidence.qualifying.length === 0) {
    res.status(409).json({
      error: "The proposal head has no qualifying backtest",
      detail:
        "Save a completed backtest of this exact version, run by this environment's clean build " +
        "on the currently deployed algorithm version, before approval.",
      rejectedBacktests: evidence.rejected,
    });
    return;
  }

  // One live run per strategy (0004's strategy_runs_single_live). Promoting a
  // new version of a strategy that is already trading would orphan its open
  // positions — the new instance knows nothing about them — so the live run
  // has to be stopped deliberately first.
  if (orchestrator.hasStrategyWithConfigId(proposal.strategyId)) {
    res.status(409).json({
      error: "This strategy is already live",
      detail: "Stop its running version first, then approve — its open positions need a deliberate hand-off.",
    });
    return;
  }

  // Sizing settled during review wins over what the author proposed. This is the
  // whole capital mechanism — no allocation table, just the riskBudget that
  // RiskEngine.checkStrategyBudget already enforces on every order.
  //
  // The strategy's identity is the strategies row. Versions carry no id of their
  // own inside config, and strategy.id keys the risk budget, rejection
  // attribution, and the already-live check above — left undefined, every
  // approved strategy would share one budget.
  const config: Record<string, unknown> = {
    ...(version.config as unknown as Record<string, unknown>),
    id: proposal.strategyId,
  };
  if (approvedCapitalPct !== undefined) {
    const budget = (config.riskBudget as Record<string, unknown> | undefined) ?? {};
    config.riskBudget = { ...budget, maxCapitalPct: approvedCapitalPct };
  }

  // Settle first: the guarded update is the mutex. A second lead clicking at the
  // same moment gets zero rows back here and is told someone beat them to it.
  let settled;
  try {
    settled = await settleProposal(id, {
      status: "approved",
      approvedBy: req.user!.id,
      approvedCapitalPct: approvedCapitalPct ?? null,
      expectedHeadVersionId,
    });
  } catch (err) {
    logger.error("approveProposal: settle failed", { id, err });
    res.status(500).json({ error: "Failed to record approval" });
    return;
  }
  if (!settled) {
    res.status(409).json({ error: "Proposal was already settled by someone else" });
    return;
  }

  const runId = newId();
  let run: StrategyRun;
  let strategy;
  try {
    strategy = factory(config);
    await liveRuns.prepare(strategy);

    run = {
      id: runId,
      strategyId: proposal.strategyId,
      strategyType: strategyType as StrategyType,
      strategyVersion: strategy.version,
      name: (config.name as string | undefined) ?? `${strategyType} run`,
      config: config as unknown as StrategyRun["config"],
      status: "running",
      executionMode: executionMode ?? "paper",
      runtimeOrigin: env.runtimeOrigin,
      buildSha: env.buildSha,
      buildDirty: env.buildDirty,
      startedAt: nowMs(),
      versionId: version.id,
      proposalId: proposal.id,
      ownerId: proposal.requestedBy,
      allocatedCapital: allocatedCapital(config as { riskBudget?: { maxCapitalPct?: number } }, portfolioState?.getSnapshot().equity),
      ...liveRuns.leaseFields(),
    };
    // Persist before trading: a crash between the two leaves a leased running
    // row that gets adopted, never a live strategy with no row behind it.
    await insertStrategyRun(run);
  } catch (err) {
    await reopenProposal(id);
    logger.error("approveProposal: go-live failed, proposal reopened", { id, runId, err });
    if (err instanceof StrategyAlreadyLiveError) {
      res.status(409).json({ error: "This strategy is already live — proposal reopened", detail: err.message });
      return;
    }
    res.status(500).json({
      error: "Approval recorded but the strategy failed to start — proposal reopened",
      detail: String(err),
    });
    return;
  }

  liveRuns.activate(runId, strategy);
  insertRunEvent(runId, "STARTED", `approved by ${req.user!.email ?? req.user!.id}`)
    .catch((err) => logger.warn("approveProposal: run event not recorded", { runId, err: String(err) }));

  // The run is live; a note that fails to post must not undo that.
  if (note && note.trim()) {
    await insertComment({
      proposalId: id,
      authorId: req.user!.id,
      body: note.trim(),
      kind: "approve",
    }).catch((err) => logger.warn("approveProposal: approval note not recorded", { id, err }));
  }

  logger.info("approveProposal: strategy promoted to live", {
    proposalId: id,
    runId,
    versionId: version.id,
    versionNumber: version.versionNumber,
    approvedBy: req.user!.id,
  });
  res.status(201).json({ proposal: settled, run });
}

/**
 * POST /api/proposals/:id/reject  (lead only)
 * Body: { reason }
 */
export async function rejectProposal(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const { reason } = req.body as { reason?: string };

  if (!reason || !reason.trim()) {
    res.status(400).json({ error: "reason is required — the author needs to know what to change" });
    return;
  }

  try {
    const settled = await settleProposal(id, {
      status: "rejected",
      rejectedBy: req.user!.id,
      rejectionReason: reason.trim(),
    });
    if (!settled) {
      res.status(409).json({ error: "Proposal is not open — it may already be settled" });
      return;
    }
    await insertComment({
      proposalId: id,
      authorId: req.user!.id,
      body: reason.trim(),
      kind: "request_changes",
    });
    logger.info("rejectProposal: rejected", { proposalId: id, by: req.user!.id });
    res.json(settled);
  } catch (err) {
    logger.error("rejectProposal error", { id, err });
    res.status(500).json({ error: "Failed to reject proposal" });
  }
}

/**
 * POST /api/proposals/:id/withdraw
 * The author pulling their own request back before a lead acts on it.
 */
export async function withdrawProposal(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);

  const proposal = await getProposalById(id);
  if (!proposal) {
    res.status(404).json({ error: `Proposal ${id} not found` });
    return;
  }
  if (proposal.requestedBy !== req.user!.id && req.user!.role !== "lead") {
    res.status(403).json({ error: "Only the author (or a lead) can withdraw this proposal" });
    return;
  }

  try {
    const settled = await settleProposal(id, { status: "withdrawn" });
    if (!settled) {
      res.status(409).json({ error: "Proposal is not open — it may already be settled" });
      return;
    }
    res.json(settled);
  } catch (err) {
    logger.error("withdrawProposal error", { id, err });
    res.status(500).json({ error: "Failed to withdraw proposal" });
  }
}

// ------------------------------------------------------------------
// Comments
// ------------------------------------------------------------------

const VALID_KINDS: CommentKind[] = ["comment", "suggestion", "approve", "request_changes"];

/**
 * POST /api/proposals/:id/comments
 * Body: { body, kind? }
 *
 * The verdict kinds (`approve`, `request_changes`) are review signals on the
 * thread; they do not settle the proposal on their own — that stays with the
 * explicit approve/reject endpoints so going live is never a side effect of
 * leaving a comment.
 */
export async function addComment(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const { body, kind } = req.body as { body?: string; kind?: CommentKind };

  if (!body || !body.trim()) {
    res.status(400).json({ error: "body is required" });
    return;
  }
  if (kind && !VALID_KINDS.includes(kind)) {
    res.status(400).json({ error: `kind must be one of ${VALID_KINDS.join(", ")}` });
    return;
  }
  if ((kind === "approve" || kind === "request_changes") && req.user!.role !== "lead") {
    res.status(403).json({ error: "Only a lead can leave a review verdict" });
    return;
  }

  const proposal = await getProposalById(id);
  if (!proposal) {
    res.status(404).json({ error: `Proposal ${id} not found` });
    return;
  }

  try {
    const comment = await insertComment({
      proposalId: id,
      authorId: req.user!.id,
      body: body.trim(),
      kind: kind ?? "comment",
    });
    res.status(201).json(comment);
  } catch (err) {
    logger.error("addComment error", { id, err });
    res.status(500).json({ error: "Failed to post comment" });
  }
}

/** GET /api/proposals/:id/comments */
export async function listCommentsHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  try {
    res.json(await getComments(id));
  } catch (err) {
    logger.error("listComments error", { id, err });
    res.status(500).json({ error: "Failed to fetch comments" });
  }
}
