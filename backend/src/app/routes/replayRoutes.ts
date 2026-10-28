/**
 * app/routes/replayRoutes.ts
 *
 * HTTP routes for replay session management.
 * Mounted at /api/replay by the main router.
 */

import { Router } from "express";
import {
  listReplaySessions,
  loadReplaySession,
  controlReplay,
  getReplayStatus,
  getReplayAttribution,
} from "../controllers/replayController";

const router = Router();

/** GET /api/replay/sessions — list available event log sessions */
router.get("/sessions", listReplaySessions);

/** GET /api/replay/status — current replay session state */
router.get("/status", getReplayStatus);

/** GET /api/replay/attribution — attribution report of the completed session */
router.get("/attribution", getReplayAttribution);

/** POST /api/replay/load — load a session into the replay engine */
router.post("/load", loadReplaySession);

/** POST /api/replay/control — send a playback control command */
router.post("/control", controlReplay);

export default router;
