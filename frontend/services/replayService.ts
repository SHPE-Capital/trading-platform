/**
 * services/replayService.ts
 *
 * Frontend service for replay session API calls.
 *
 * Inputs:  Session IDs and playback commands.
 * Outputs: ReplaySession state from the backend API.
 */

import { apiGet, apiPost } from "./api";
import type { ReplaySession } from "../types/api";

/**
 * Fetches all available replay session records.
 * @returns Array of session metadata objects
 */
export async function fetchReplaySessions(): Promise<ReplaySession[]> {
  return apiGet<ReplaySession[]>("/replay/sessions");
}

/**
 * Gets the current replay session status.
 * @returns Current ReplaySession or null
 */
export async function fetchReplayStatus(): Promise<ReplaySession | null> {
  return apiGet<ReplaySession | null>("/replay/status");
}

/**
 * Loads a replay session into the engine.
 * @param sessionId - Event log session UUID
 */
export async function loadReplaySession(sessionId: string): Promise<void> {
  return apiPost("/replay/load", { sessionId });
}

/**
 * Sends a playback control command to the replay engine.
 * @param command - ReplayCommand action object
 */
export async function controlReplay(
  command: { action: string; [key: string]: unknown },
): Promise<void> {
  return apiPost("/replay/control", command);
}
