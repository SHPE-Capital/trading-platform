/**
 * app/routes/runsRoutes.ts
 *
 * Per-run analytics from the ledger. Mounted at /api/runs by the main router.
 */

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { compareRunWithBacktest, getRunFills, getRunPerformance, getRunSignals } from "../controllers/performanceController";

const router = Router();

/** GET /api/runs/:runId/performance — metrics, curve, trades, funnel, events */
router.get("/:runId/performance", requireAuth, getRunPerformance);

/** GET /api/runs/:runId/fills — the run's fills, oldest first */
router.get("/:runId/fills", requireAuth, getRunFills);

/** GET /api/runs/:runId/signals — the run's latest signals and their outcomes */
router.get("/:runId/signals", requireAuth, getRunSignals);

/** POST /api/runs/:runId/compare-backtest — queue a backtest of the run's exact window */
router.post("/:runId/compare-backtest", requireAuth, compareRunWithBacktest);

export default router;
