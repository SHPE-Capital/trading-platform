/**
 * hooks/useReplay.ts
 *
 * Custom React hook for managing replay session state and controls.
 * Playback progress arrives as REPLAY_TICK over /ws/events; without an open
 * socket the hook polls the status endpoint while a session plays.
 *
 * Inputs:  Session IDs, filters and control actions from the ReplayPlayer component.
 * Outputs: { session, sessions, attribution, loadSession, control, isLoading, error }
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchReplaySessions,
  fetchReplayStatus,
  loadReplaySession,
  controlReplay,
  fetchReplayAttribution,
} from "../services/replayService";
import { useWebSocket } from "./useWebSocket";
import type {
  EventLogRecord,
  ReplayAttribution,
  ReplayFilter,
  ReplaySession,
  ReplayTickEvent,
} from "../types/api";

const POLL_MS = 1_000;

interface UseReplayResult {
  session: ReplaySession | null;
  sessions: EventLogRecord[];
  attribution: ReplayAttribution | null;
  isLoading: boolean;
  error: string | null;
  loadSession: (sessionId: string, filter?: ReplayFilter) => Promise<void>;
  control: (action: string, extra?: Record<string, unknown>) => Promise<void>;
  refreshStatus: () => void;
}

/**
 * Manages replay session listing, loading, playback control and attribution.
 * @returns UseReplayResult
 */
export function useReplay(): UseReplayResult {
  const [session, setSession] = useState<ReplaySession | null>(null);
  const [sessions, setSessions] = useState<EventLogRecord[]>([]);
  const [attribution, setAttribution] = useState<ReplayAttribution | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { lastMessage, readyState } = useWebSocket<{ type?: string }>("/ws/events");

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [list, current] = await Promise.all([
        fetchReplaySessions(),
        fetchReplayStatus(),
      ]);
      setSessions(list);
      setSession(current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load replay sessions");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Live progress from the replay runtime.
  useEffect(() => {
    if (lastMessage?.type !== "REPLAY_TICK") return;
    const tick = lastMessage as ReplayTickEvent;
    setSession((prev) =>
      prev && prev.id === tick.sessionId
        ? { ...prev, cursor: tick.cursor, totalEvents: tick.totalEvents, status: tick.status, speed: tick.speed, simulatedNow: tick.simulatedNow }
        : prev,
    );
  }, [lastMessage]);

  // Fallback when the socket is not open: poll while playing.
  const isPlaying = session?.status === "playing";
  useEffect(() => {
    if (!isPlaying || readyState === "open") return;
    const timer = setInterval(() => {
      fetchReplayStatus().then(setSession).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [isPlaying, readyState]);

  // Attribution is only available once the session completes.
  const completedId = session?.status === "completed" ? session.id : null;
  useEffect(() => {
    if (!completedId) return;
    let cancelled = false;
    fetchReplayAttribution()
      .then((report) => { if (!cancelled) setAttribution(report); })
      .catch(() => { if (!cancelled) setAttribution(null); });
    return () => { cancelled = true; };
  }, [completedId]);

  const loadSession = useCallback(async (sessionId: string, filter?: ReplayFilter) => {
    try {
      setError(null);
      setAttribution(null);
      setSession(await loadReplaySession(sessionId, filter));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load replay session");
    }
  }, []);

  const control = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    try {
      setError(null);
      if (action === "reset" || action === "seek" || action === "seek_ts") setAttribution(null);
      setSession(await controlReplay({ action, ...extra }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replay command failed");
    }
  }, []);

  return { session, sessions, attribution, isLoading, error, loadSession, control, refreshStatus: fetchData };
}
