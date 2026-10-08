/**
 * app/routes/backtestRoutes.ts
 *
 * HTTP routes for backtest management.
 * Mounted at /api/backtests by the main router.
 */

import { Router } from "express";
import {
  listBacktests,
  getBacktest,
  runBacktest,
  streamBacktest,
  saveBacktest,
} from "../controllers/backtestController";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

/** GET /api/backtests — list all backtest result summaries */
router.get("/", listBacktests);

/** GET /api/backtests/:id/stream — SSE: status, progress, then complete or error */
router.get("/:id/stream", streamBacktest);

/** GET /api/backtests/:id — saved result, or a finished run still in its save window */
router.get("/:id", getBacktest);

/**
 * POST /api/backtests/run — queue a run for a worker. Authentication makes the
 * per-member concurrency cap mandatory and prevents anonymous queue abuse.
 */
router.post("/run", requireAuth, runBacktest);

/** POST /api/backtests/:id/save — explicitly persist a completed run (member-only) */
router.post("/:id/save", requireAuth, saveBacktest);

export default router;
