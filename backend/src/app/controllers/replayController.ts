/**
 * app/controllers/replayController.ts
 *
 * Controller for replay session endpoints.
 * Handles listing available event logs, loading sessions, and
 * sending playback control commands (play, pause, step, seek, speed).
 *
 * Inputs:  HTTP requests from the frontend replay view.
 * Outputs: JSON session state; forwards commands to the ReplayEngine.
 */

import type { Request, Response } from "express";
import { logger } from "../../utils/logger";
import type { ReplayCommand } from "../../types/replay";

/**
 * GET /api/replay/sessions
 * Lists available recorded event log sessions that can be replayed.
 * @param req - Express Request
 * @param res - Express Response: EventLogRecord[] JSON array
 */
export async function listReplaySessions(req: Request, res: Response): Promise<void> {
  // TODO: Query event_logs table via Supabase repository
  res.json([]);
}

/**
 * POST /api/replay/load
 * Loads a specific event log session into the ReplayEngine.
 * Body: { sessionId: string }
 * @param req - Express Request with sessionId in body
 * @param res - Express Response: { message: string, session: ReplaySession }
 */
export async function loadReplaySession(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.body as { sessionId: string };
  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  // TODO: Load event log from DB, instantiate ReplayEngine, load session
  logger.info("loadReplaySession: received request", { sessionId });
  res.status(501).json({ error: "Not yet implemented" });
}

/**
 * POST /api/replay/control
 * Sends a playback control command to the active ReplayEngine.
 * Body: ReplayCommand
 * @param req - Express Request with ReplayCommand in body
 * @param res - Express Response: { message: string }
 */
export async function controlReplay(req: Request, res: Response): Promise<void> {
  const command = req.body as ReplayCommand;
  if (!command?.action) {
    res.status(400).json({ error: "command.action is required" });
    return;
  }
  // TODO: Forward command to the active ReplayEngine instance
  logger.info("controlReplay: received command", { action: command.action });
  res.status(501).json({ error: "Not yet implemented" });
}

/**
 * GET /api/replay/status
 * Returns the current status of the active replay session.
 * @param req - Express Request
 * @param res - Express Response: ReplaySession JSON or null
 */
export async function getReplayStatus(req: Request, res: Response): Promise<void> {
  // TODO: Return current ReplayEngine session state
  res.json(null);
}
