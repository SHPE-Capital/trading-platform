/**
 * app/routes/strategiesRoutes.ts
 *
 * HTTP routes for strategy management.
 * Mounted at /api/strategies by the main router.
 */

import { Router } from "express";
import {
  listStrategyRuns,
  getStrategyRun,
  startStrategyRun,
  stopStrategyRun,
} from "../controllers/strategiesController";

const router = Router();

/** GET /api/strategies — list all strategy runs */
router.get("/", listStrategyRuns);

/** GET /api/strategies/:id — get a specific strategy run */
router.get("/:id", getStrategyRun);

/** POST /api/strategies/start — create and start a new strategy run */
router.post("/start", startStrategyRun);

/** POST /api/strategies/:id/stop — stop a running strategy */
router.post("/:id/stop", stopStrategyRun);

export default router;
