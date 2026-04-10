/**
 * app/routes/systemRoutes.ts
 *
 * HTTP routes for system health and status endpoints.
 * Mounted at /api/system by the main router.
 */

import { Router } from "express";
import { healthCheck, getSystemStatus } from "../controllers/systemController";

const router = Router();

/** GET /api/system/health — liveness check */
router.get("/health", healthCheck);

/** GET /api/system/status — engine and connection status */
router.get("/status", getSystemStatus);

export default router;
