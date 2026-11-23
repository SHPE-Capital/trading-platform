/**
 * services/replayService.ts
 *
 * Frontend service for replay session API calls.
 *
 * Inputs:  Session IDs, filters and playback commands.
 * Outputs: Recorded event logs, ReplaySession state and attribution from the backend API.
 */

import { apiGet, apiPost } from "./api";
import type { EventLogRecord, ReplayAttribution, ReplayFilter, ReplaySession } from "../types/api";

/**
 * Fetches all recorded event logs that can be loaded for replay.
 * @returns Event log metadata, newest first
 */
export async function fetchReplaySessions(): Promise<EventLogRecord[]> {
  return apiGet<EventLogRecord[]>("/replay/sessions");
}

/**
 * Gets the current replay session status.
 * @returns Current ReplaySession or null
 */
export async function fetchReplayStatus(): Promise<ReplaySession | null> {
  return apiGet<ReplaySession | null>("/replay/status");
}

/**
 * Loads an event log into the engine, optionally filtered.
 * @param sessionId - Event log UUID
 * @param filter - Optional constraints on which events are replayed
 * @returns The loaded session, paused at its first event
 */
export async function loadReplaySession(sessionId: string, filter?: ReplayFilter): Promise<ReplaySession | null> {
  const res = await apiPost<{ session: ReplaySession | null }>("/replay/load", filter ? { sessionId, filter } : { sessionId });
  return res.session;
}

/**
 * Sends a playback control command to the replay engine.
 * @param command - ReplayCommand action object
 * @returns The session state after the command
 */
export async function controlReplay(
  command: { action: string; [key: string]: unknown },
): Promise<ReplaySession | null> {
  const res = await apiPost<{ session: ReplaySession | null }>("/replay/control", command);
  return res.session;
}

/**
 * Fetches the attribution report of the loaded session (completed sessions only).
 * @returns ReplayAttribution
 */
export async function fetchReplayAttribution(): Promise<ReplayAttribution> {
  return apiGet<ReplayAttribution>("/replay/attribution");
}
