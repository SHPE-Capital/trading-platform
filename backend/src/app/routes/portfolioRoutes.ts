/**
 * app/routes/portfolioRoutes.ts
 *
 * HTTP routes for portfolio data.
 * Mounted at /api/portfolio by the main router.
 */

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import {
  getPortfolioSnapshot,
  getEquityCurve,
  getOrders,
  getFills,
} from "../controllers/portfolioController";

const router = Router();

/** GET /api/portfolio/snapshot — current portfolio state */
router.get("/snapshot", requireAuth, getPortfolioSnapshot);

/** GET /api/portfolio/equity-curve — historical equity snapshots */
router.get("/equity-curve", requireAuth, getEquityCurve);

/** GET /api/portfolio/orders — order history for a strategy run */
router.get("/orders", requireAuth, getOrders);

/** GET /api/portfolio/fills — the most recent fills, newest first */
router.get("/fills", requireAuth, getFills);

export default router;
