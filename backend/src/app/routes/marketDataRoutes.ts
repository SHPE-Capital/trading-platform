/**
 * app/routes/marketDataRoutes.ts
 *
 * HTTP routes for live market data snapshots.
 * Mounted at /api/market-data by the main router.
 */

import { Router } from "express";
import {
  getTrackedSymbols,
  getSymbolSnapshot,
  getCachedBars,
} from "../controllers/marketDataController";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

/** GET /api/market-data/symbols — list tracked symbols */
router.get("/symbols", getTrackedSymbols);

/** GET /api/market-data/snapshot/:symbol — latest quote for a symbol */
router.get("/snapshot/:symbol", getSymbolSnapshot);

/** GET /api/market-data/bars — cached bars for seeding a local sim replay */
router.get("/bars", requireAuth, getCachedBars);

export default router;
