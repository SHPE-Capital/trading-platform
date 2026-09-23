/**
 * app/routes/strategiesRoutes.ts
 *
 * HTTP routes for strategy management.
 * Mounted at /api/strategies by the main router.
 *
 * IMPORTANT: Config CRUD routes (/configs/*) must be registered before /:id
 * to prevent Express treating the literal segment "configs" as an ID param.
 */

import { Router } from "express";
import {
  listStrategyRuns,
  getStrategyRun,
  startStrategyRun,
  stopStrategyRun,
  listStrategies,
  getStrategyDefaults,
  createStrategy,
  updateStrategyConfig,
  deleteStrategyConfig,
} from "../controllers/strategiesController";
import { listVersions, createVersion } from "../controllers/proposalsController";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

// ------------------------------------------------------------------
// Config CRUD — must appear before /:id routes
// ------------------------------------------------------------------

/** GET /api/strategies/configs — list all saved strategy configs */
router.get("/configs", listStrategies);

/** GET /api/strategies/configs/defaults/:type — hardcoded type defaults */
router.get("/configs/defaults/:type", getStrategyDefaults);

/** POST /api/strategies/configs — create a new saved config (also its v1 version, so requires an author) */
router.post("/configs", requireAuth, createStrategy);

/** PUT /api/strategies/configs/:configId — update name/config (version unchanged); any signed-in member may edit */
router.put("/configs/:configId", requireAuth, updateStrategyConfig);

/** DELETE /api/strategies/configs/:configId — remove a saved config */
router.delete("/configs/:configId", deleteStrategyConfig);

// ------------------------------------------------------------------
// Run management
// ------------------------------------------------------------------

/** GET /api/strategies — list all strategy runs */
router.get("/", listStrategyRuns);

/** GET /api/strategies/:id — get a specific strategy run */
router.get("/:id", getStrategyRun);

/** POST /api/strategies/start — create and start a new strategy run */
router.post("/start", startStrategyRun);

/** POST /api/strategies/:id/stop — stop a running strategy */
router.post("/:id/stop", stopStrategyRun);

// ------------------------------------------------------------------
// Config version history
// ------------------------------------------------------------------

/** GET /api/strategies/:strategyId/versions — full config history */
router.get("/:strategyId/versions", requireAuth, listVersions);

/** POST /api/strategies/:strategyId/versions — append an immutable edit */
router.post("/:strategyId/versions", requireAuth, createVersion);

export default router;
