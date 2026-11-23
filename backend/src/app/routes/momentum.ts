/**
 * app/routes/momentum.ts
 *
 * Momentum dashboard API. Mounted at /api/momentum by the main router.
 * Reads are open to signed-in members; uploads are backend-only (ingest token).
 */

import { Router } from "express";
import {
  getActiveConfig,
  getLiveStatus,
  getResultsSummary,
  postWeeklyConfig,
  postResultsSummary,
} from "../controllers/momentumController";
import { requireAuth } from "../middleware/requireAuth";
import { requireIngestToken } from "../middleware/requireIngestToken";

const router = Router();

/** GET /api/momentum/config?policy= — active weekly config, freshness, no_deployment reason */
router.get("/config", requireAuth, getActiveConfig);
/** GET /api/momentum/status?policy= — entries enabled/disabled and why, positions, halt, last bar */
router.get("/status", requireAuth, getLiveStatus);
/** GET /api/momentum/results/summary — latest research results summary (E2 contract) */
router.get("/results/summary", requireAuth, getResultsSummary);
/** POST /api/momentum/artifacts/weekly-config — upload a weekly_config.v1 artifact (ingest token) */
router.post("/artifacts/weekly-config", requireIngestToken, postWeeklyConfig);
/** POST /api/momentum/results/summary — upload a research results summary (ingest token) */
router.post("/results/summary", requireIngestToken, postResultsSummary);

export default router;
