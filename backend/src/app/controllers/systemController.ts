/**
 * app/controllers/systemController.ts
 *
 * Controller for system-level endpoints: health check, engine status,
 * and kill-switch activation. These endpoints give the frontend visibility
 * into the backend's current operational state.
 *
 * Inputs:  HTTP requests from the frontend.
 * Outputs: JSON responses with system status information.
 */

import type { Request, Response } from "express";
import { nowIso } from "../../utils/time";

/**
 * GET /api/health
 * Returns a simple health check response confirming the server is running.
 * @param req - Express Request
 * @param res - Express Response: { status: "ok", ts: string }
 */
export function healthCheck(req: Request, res: Response): void {
  res.json({ status: "ok", ts: nowIso() });
}

/**
 * GET /api/status
 * Returns the current engine and connection status.
 * @param req - Express Request
 * @param res - Express Response: engine status object
 */
export function getSystemStatus(req: Request, res: Response): void {
  // Placeholder — in a real implementation this queries the Orchestrator status
  res.json({
    engineRunning: false,
    mode: "idle",
    connectedToAlpaca: false,
    ts: nowIso(),
  });
}
