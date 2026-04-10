/**
 * app/routes/index.ts
 *
 * Mounts all API route modules onto the Express router.
 * All routes are prefixed with /api by convention.
 *
 * Inputs:  Express Router from the main app.
 * Outputs: Configured Express Router with all sub-routes mounted.
 */

import { Router } from "express";
import systemRoutes from "./systemRoutes";
import strategyRoutes from "./strategiesRoutes";
import portfolioRoutes from "./portfolioRoutes";
import backtestRoutes from "./backtestRoutes";
import replayRoutes from "./replayRoutes";
import marketDataRoutes from "./marketDataRoutes";

const router = Router();

router.use("/system", systemRoutes);
router.use("/strategies", strategyRoutes);
router.use("/portfolio", portfolioRoutes);
router.use("/backtests", backtestRoutes);
router.use("/replay", replayRoutes);
router.use("/market-data", marketDataRoutes);

export default router;
