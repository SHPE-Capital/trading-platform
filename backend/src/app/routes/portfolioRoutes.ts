/**
 * app/routes/portfolioRoutes.ts
 *
 * HTTP routes for portfolio data.
 * Mounted at /api/portfolio by the main router.
 */

import { Router } from "express";
import {
  getPortfolioSnapshot,
  getEquityCurve,
  getOrders,
} from "../controllers/portfolioController";

const router = Router();

/** GET /api/portfolio/snapshot — current portfolio state */
router.get("/snapshot", getPortfolioSnapshot);

/** GET /api/portfolio/equity-curve — historical equity snapshots */
router.get("/equity-curve", getEquityCurve);

/** GET /api/portfolio/orders — order history for a strategy run */
router.get("/orders", getOrders);

export default router;
