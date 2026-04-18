import type { Request, Response } from "express";
import { logger } from "../../utils/logger";
import type { ReplayCommand } from "../../types/replay";
import type { AppContext } from "../context";

/**
 * GET /api/replay/sessions
 * TODO: Query event_logs table via Supabase repository once that repo function exists.
 */
export async function listReplaySessions(_req: Request, res: Response): Promise<void> {
  res.json([]);
}

/**
 * POST /api/replay/load
 * Body: { sessionId: string }
 * TODO: Load event log from DB and construct a ReplaySession once the repository function exists.
 */
export async function loadReplaySession(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.body as { sessionId: string };
  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  const { replayEngine } = req.app.locals.ctx as AppContext;
  if (!replayEngine) {
    res.status(503).json({ error: "Replay engine not available in this runtime mode" });
    return;
  }
  logger.info("loadReplaySession: received request", { sessionId });
  res.status(501).json({ error: "event_logs repository not yet implemented" });
}

/**
 * POST /api/replay/control
 * Body: ReplayCommand
 */
export async function controlReplay(req: Request, res: Response): Promise<void> {
  const command = req.body as ReplayCommand;
  if (!command?.action) {
    res.status(400).json({ error: "command.action is required" });
    return;
  }
  const { replayEngine } = req.app.locals.ctx as AppContext;
  if (!replayEngine) {
    res.status(503).json({ error: "Replay engine not available in this runtime mode" });
    return;
  }
  replayEngine.control(command);
  logger.info("controlReplay: command applied", { action: command.action });
  res.json({ message: `Command '${command.action}' applied` });
}

/**
 * GET /api/replay/status
 */
export async function getReplayStatus(req: Request, res: Response): Promise<void> {
  const { replayEngine } = req.app.locals.ctx as AppContext;
  if (!replayEngine) {
    res.json(null);
    return;
  }
  res.json(replayEngine.getSession());
}
