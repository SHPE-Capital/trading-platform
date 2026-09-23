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

/** GET /api/backtests/:id/stream — SSE stream of live progress events for an active run */
router.get("/:id/stream", streamBacktest);

/** GET /api/backtests/:id — get full backtest result with equity curve */
router.get("/:id", getBacktest);

/** POST /api/backtests/run — trigger a new backtest run */
router.post("/run", runBacktest);

/** POST /api/backtests/:id/save — explicitly persist a completed run (member-only) */
router.post("/:id/save", requireAuth, saveBacktest);

export default router;
