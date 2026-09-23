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
} from "../../adapters/supabase/reviewRepositories";
import { getStrategyById, insertStrategyRun, updateStrategy } from "../../adapters/supabase/repositories";
import { STRATEGY_FACTORY } from "../../config/strategyDefaults";
import { newId } from "../../utils/ids";
import { nowMs } from "../../utils/time";
import { logger } from "../../utils/logger";
import type { AppContext } from "../context";
import type { StrategyRun, StrategyType } from "../../types/strategy";
import type { UUID } from "../../types/common";
import type { CommentKind, ProposalStatus } from "../../types/review";

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

    const backtests = await getBacktestsForVersion(proposal.headVersionId);

    res.json({
      proposal,
      strategy,
      headVersion,
      versions,
      backtests,
      comments,
      timeline,
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
 * POST /api/proposals/:id/approve  (lead only)
 * Body: { approvedCapitalPct?, note? }
 *
 * The only path that puts a strategy live. Settles the proposal first — a
 * guarded update that two simultaneous approvals cannot both win — then builds
 * the strategy from the cited version's persisted config, registers it, and
 * writes the single strategy_runs row. Any failure after the settle rolls the
 * proposal back to open so the queue stays truthful.
 */
export async function approveProposal(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const { approvedCapitalPct, note } = req.body as {
    approvedCapitalPct?: number;
    note?: string;
  };

  if (
    approvedCapitalPct !== undefined &&
    (typeof approvedCapitalPct !== "number" || approvedCapitalPct <= 0 || approvedCapitalPct > 1)
  ) {
    res.status(400).json({ error: "approvedCapitalPct must be between 0 (exclusive) and 1" });
    return;
  }

  const { orchestrator, marketDataAdapter, executionMode } = req.app.locals.ctx as AppContext;
  if (!orchestrator) {
    res.status(503).json({
      error: "Orchestrator not available in this runtime mode",
      detail: "Approving starts a live strategy, so it must run against the trading process.",
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

  // Sizing settled during review wins over what the author proposed. This is the
  // whole capital mechanism — no allocation table, just the riskBudget that
  // RiskEngine.checkStrategyBudget already enforces on every order.
  const config: Record<string, unknown> = { ...(version.config as unknown as Record<string, unknown>) };
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
  let registered = false;
  try {
    const strategy = factory(config);
    // Mirrors startStrategyRun: register in memory first, persist second, and
    // undo the registration if the write fails. listStrategyRuns treats the
    // orchestrator as authoritative for isLive, so the two must not diverge.
    orchestrator.registerStrategy(strategy, runId);
    registered = true;

    const symbols = Array.isArray(config.symbols) ? (config.symbols as string[]) : [];
    if (marketDataAdapter && symbols.length > 0) marketDataAdapter.subscribe(symbols);

    const run: StrategyRun = {
      id: runId,
      strategyId: proposal.strategyId,
      strategyType: strategyType as StrategyType,
      strategyVersion: strategy.version,
      name: (config.name as string | undefined) ?? `${strategyType} run`,
      config: config as unknown as StrategyRun["config"],
      status: "running",
      executionMode: executionMode ?? "paper",
      startedAt: nowMs(),
      totalSignals: 0,
      totalOrders: 0,
      realizedPnl: 0,
      versionId: version.id,
      proposalId: proposal.id,
      ownerId: proposal.requestedBy,
    };
    await insertStrategyRun(run);

    if (note && note.trim()) {
      await insertComment({
        proposalId: id,
        authorId: req.user!.id,
        body: note.trim(),
        kind: "approve",
      });
    }

    logger.info("approveProposal: strategy promoted to live", {
      proposalId: id,
      runId,
      versionId: version.id,
      versionNumber: version.versionNumber,
      approvedBy: req.user!.id,
    });
    res.status(201).json({ proposal: settled, run });
  } catch (err) {
    if (registered) orchestrator.deregisterStrategy(runId);
    await reopenProposal(id);
    logger.error("approveProposal: go-live failed, proposal reopened", { id, runId, err });
    res.status(500).json({
      error: "Approval recorded but the strategy failed to start — proposal reopened",
      detail: String(err),
    });
  }
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
