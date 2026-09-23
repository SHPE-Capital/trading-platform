/**
 * app/routes/governanceRoutes.ts
 *
 * Shared-book governance views. Mounted at /api/governance by the main router.
 */

import { Router } from "express";
import { getContention } from "../controllers/governanceController";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

/** GET /api/governance/contention?days=7 — blocked-order counts per member and strategy */
router.get("/contention", requireAuth, getContention);

export default router;
