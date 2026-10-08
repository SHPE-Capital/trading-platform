/**
 * app/routes/brokerRoutes.ts
 *
 * The account as the broker reports it, and the ledger's drift against it.
 * Mounted at /api/broker by the main router.
 */

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { getBrokerAccount, getBrokerDrift, getBrokerHistory, getBrokerPositions } from "../controllers/brokerController";

const router = Router();

router.get("/account", requireAuth, getBrokerAccount);
router.get("/positions", requireAuth, getBrokerPositions);
router.get("/history", requireAuth, getBrokerHistory);
router.get("/drift", requireAuth, getBrokerDrift);

export default router;
