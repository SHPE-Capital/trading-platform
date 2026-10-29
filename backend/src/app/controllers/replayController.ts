import type { Request, Response } from "express";
import { logger } from "../../utils/logger";
import { newId } from "../../utils/ids";
import { listEventLogs, getEventLog } from "../../adapters/supabase/eventLogRepository";
import { applyFilter, isEmptyFilter } from "../../core/replay/replayFilter";
import type { ReplayCommand, ReplayFilter, ReplaySession, ReplaySpeed } from "../../types/replay";
import type { AppContext } from "../context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/replay/sessions
 * Metadata of every recorded event log, newest first.
 */
export async function listReplaySessions(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await listEventLogs());
  } catch (err) {
    logger.error("listReplaySessions failed", { reason: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "Failed to list replay sessions" });
  }
}

/**
 * POST /api/replay/load
 * Body: { sessionId: string; filter?: ReplayFilter }
 * Loads an event log, optionally filtered, into the engine — paused at the
 * first event — and starts attribution for it.
 */
export async function loadReplaySession(req: Request, res: Response): Promise<void> {
  const { sessionId, filter } = (req.body ?? {}) as { sessionId?: string; filter?: ReplayFilter };
  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  if (!UUID_RE.test(sessionId)) {
    res.status(400).json({ error: "sessionId must be a UUID" });
    return;
  }
  if (filter !== undefined && (typeof filter !== "object" || filter === null || isEmptyFilter(filter))) {
    res.status(400).json({ error: "filter, when present, must set at least one field" });
    return;
  }
  const { replayEngine, attributionCollector } = req.app.locals.ctx as AppContext;
  if (!replayEngine) {
    res.status(503).json({ error: "Replay engine not available in this runtime mode" });
    return;
  }

  try {
    const log = await getEventLog(sessionId);
    if (!log) {
      res.status(404).json({ error: `Event log ${sessionId} not found` });
      return;
    }
    const events = filter ? applyFilter(log.events, filter) : log.events;
    if (events.length === 0) {
      res.status(422).json({ error: "No events match the filter" });
      return;
    }

    const session: ReplaySession = {
      id: newId(),
      name: log.record.name,
      sourceRunId: log.record.runId,
      events,
      totalEvents: events.length,
      cursor: 0,
      status: "paused",
      speed: 1,
      replayStrategies: false,
      simulatedNow: events[0].ts,
      createdAt: Date.now(),
      description: log.record.description,
    };
    replayEngine.load(session);
    attributionCollector?.start(session.id);
    logger.info("loadReplaySession: session loaded", {
      sessionId, replaySessionId: session.id, totalEvents: events.length, filtered: !!filter,
    });
    res.json({ message: "Session loaded", session: replayEngine.getStatus() });
  } catch (err) {
    logger.error("loadReplaySession failed", { sessionId, reason: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "Failed to load replay session" });
  }
}

/** Commands after which already-collected attribution no longer matches what will play. */
const RESTARTS_ATTRIBUTION = new Set<ReplayCommand["action"]>(["reset", "seek", "seek_ts"]);

/** The only speeds the engine divides inter-event gaps by (see ReplaySpeed). */
const REPLAY_SPEEDS: ReadonlySet<ReplaySpeed> = new Set<ReplaySpeed>([0.25, 0.5, 1, 2, 5, 10, "step"]);

/**
 * Validates an untrusted control payload into a ReplayCommand.
 *
 * The engine takes these fields at face value: a speed of 0 or a non-numeric
 * one makes the playback delay Infinity or NaN, which setTimeout floors to 1ms
 * so the replay runs flat out instead of slowing, and a non-integer
 * targetIndex clamps to NaN, which wedges the session — the cursor serializes
 * as null and the next step throws. So the check belongs here, at the edge,
 * before any of it reaches the engine.
 *
 * @returns the typed command, or the reason it was rejected
 */
function parseCommand(body: unknown): { command: ReplayCommand } | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "command.action is required" };
  const { action } = body as { action?: unknown };
  if (typeof action !== "string" || action === "") return { error: "command.action is required" };

  switch (action) {
    case "play":
    case "pause":
    case "step":
    case "reset":
      return { command: { action } };

    case "seek": {
      const { targetIndex } = body as { targetIndex?: unknown };
      if (typeof targetIndex !== "number" || !Number.isInteger(targetIndex) || targetIndex < 0) {
        return { error: "seek requires targetIndex to be a non-negative integer" };
      }
      return { command: { action, targetIndex } };
    }

    case "seek_ts": {
      const { targetTs } = body as { targetTs?: unknown };
      if (typeof targetTs !== "number" || !Number.isFinite(targetTs)) {
        return { error: "seek_ts requires targetTs to be a finite number" };
      }
      return { command: { action, targetTs } };
    }

    case "set_speed": {
      const { speed } = body as { speed?: unknown };
      if (!REPLAY_SPEEDS.has(speed as ReplaySpeed)) {
        return { error: `set_speed requires speed to be one of ${[...REPLAY_SPEEDS].join(", ")}` };
      }
      return { command: { action, speed: speed as ReplaySpeed } };
    }

    default:
      return { error: `Unknown action '${action}'` };
  }
}

/**
 * POST /api/replay/control
 * Body: ReplayCommand
 * Reset and seeks restart attribution, so replaying a stretch twice does not
 * count its fills twice.
 */
export async function controlReplay(req: Request, res: Response): Promise<void> {
  const parsed = parseCommand(req.body);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { command } = parsed;
  const { replayEngine, attributionCollector } = req.app.locals.ctx as AppContext;
  if (!replayEngine) {
    res.status(503).json({ error: "Replay engine not available in this runtime mode" });
    return;
  }
  replayEngine.control(command);
  const session = replayEngine.getStatus();
  if (session && attributionCollector && RESTARTS_ATTRIBUTION.has(command.action)) {
    attributionCollector.start(session.id);
  }
  logger.info("controlReplay: command applied", { action: command.action });
  res.json({ message: `Command '${command.action}' applied`, session });
}

/**
 * GET /api/replay/status
 * The loaded session without its events, or null.
 */
export async function getReplayStatus(req: Request, res: Response): Promise<void> {
  const { replayEngine } = req.app.locals.ctx as AppContext;
  if (!replayEngine) {
    res.json(null);
    return;
  }
  res.json(replayEngine.getStatus());
}

/**
 * GET /api/replay/attribution
 * Attribution report of the loaded session, once its playback has completed.
 */
export async function getReplayAttribution(req: Request, res: Response): Promise<void> {
  const { replayEngine, attributionCollector } = req.app.locals.ctx as AppContext;
  if (!replayEngine || !attributionCollector) {
    res.status(503).json({ error: "Replay attribution not available in this runtime mode" });
    return;
  }
  const session = replayEngine.getStatus();
  if (!session || session.status !== "completed" || attributionCollector.activeSessionId !== session.id) {
    res.status(409).json({ error: "Attribution is available once the loaded session completes" });
    return;
  }
  res.json(attributionCollector.getAttribution());
}
