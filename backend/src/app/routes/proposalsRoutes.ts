/**
 * app/routes/proposalsRoutes.ts
 *
 * HTTP routes for the strategy review workflow.
 * Mounted at /api/proposals by the main router.
 *
 * Access model, matching the RLS policies in 0003/0007: reads are open to any
 * signed-in member (the book is shared, so the queue is shared), writes are
 * scoped — anyone may comment or open a proposal, only a lead may settle one.
 */

import { Router } from "express";
import {
  listProposalsHandler,
  getProposalDetail,
  createProposal,
  approveProposal,
  rejectProposal,
  withdrawProposal,
  addComment,
  listCommentsHandler,
} from "../controllers/proposalsController";
import { requireAuth, requireRole } from "../middleware/requireAuth";

const router = Router();

/** GET /api/proposals?status=open — the review queue */
router.get("/", requireAuth, listProposalsHandler);

/** GET /api/proposals/:id — full review page payload */
router.get("/:id", requireAuth, getProposalDetail);

/** POST /api/proposals — open a promotion request */
router.post("/", requireAuth, createProposal);

/** POST /api/proposals/:id/approve — lead only; this is what goes live */
router.post("/:id/approve", requireAuth, requireRole("lead"), approveProposal);

/** POST /api/proposals/:id/reject — lead only */
router.post("/:id/reject", requireAuth, requireRole("lead"), rejectProposal);

/** POST /api/proposals/:id/withdraw — the author pulling their own request */
router.post("/:id/withdraw", requireAuth, withdrawProposal);

/** GET /api/proposals/:id/comments */
router.get("/:id/comments", requireAuth, listCommentsHandler);

/** POST /api/proposals/:id/comments — verdict kinds are gated to leads in the controller */
router.post("/:id/comments", requireAuth, addComment);

export default router;
