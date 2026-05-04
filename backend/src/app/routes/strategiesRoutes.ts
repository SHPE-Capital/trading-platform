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

const router = Router();

// ------------------------------------------------------------------
// Config CRUD — must appear before /:id routes
// ------------------------------------------------------------------

/** GET /api/strategies/configs — list all saved strategy configs */
router.get("/configs", listStrategies);

/** GET /api/strategies/configs/defaults/:type — hardcoded type defaults */
router.get("/configs/defaults/:type", getStrategyDefaults);

/** POST /api/strategies/configs — create a new saved config */
router.post("/configs", createStrategy);

/** PUT /api/strategies/configs/:configId — update name/config (version unchanged) */
router.put("/configs/:configId", updateStrategyConfig);

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

export default router;
