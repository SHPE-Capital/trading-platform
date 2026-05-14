/**
 * app/routes/systemRoutes.ts
 *
 * HTTP routes for system health and status endpoints.
 * Mounted at /api/system by the main router.
 */

import { Router } from "express";
import { healthCheck, getSystemStatus, setKillSwitch } from "../controllers/systemController";

const router = Router();

/** GET /api/system/health — liveness check */
router.get("/health", healthCheck);

/** GET /api/system/status — engine and connection status */
router.get("/status", getSystemStatus);

/** POST /api/system/kill-switch — halt or resume all new orders */
router.post("/kill-switch", setKillSwitch);

export default router;
