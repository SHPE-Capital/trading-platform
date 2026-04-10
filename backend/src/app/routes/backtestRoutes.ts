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
} from "../controllers/backtestController";

const router = Router();

/** GET /api/backtests — list all backtest result summaries */
router.get("/", listBacktests);

/** GET /api/backtests/:id — get full backtest result with equity curve */
router.get("/:id", getBacktest);

/** POST /api/backtests/run — trigger a new backtest run */
router.post("/run", runBacktest);

export default router;
