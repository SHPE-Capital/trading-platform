/**
 * hooks/useReplay.ts
 *
 * Custom React hook for managing replay session state and controls.
 *
 * Inputs:  Session IDs and control actions from the ReplayPlayer component.
 * Outputs: { session, sessions, loadSession, control, isLoading, error }
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchReplaySessions, fetchReplayStatus, loadReplaySession, controlReplay } from "../services/replayService";
import type { ReplaySession } from "../types/api";

interface UseReplayResult {
  session: ReplaySession | null;
  sessions: ReplaySession[];
  isLoading: boolean;
  error: string | null;
  loadSession: (sessionId: string) => Promise<void>;
  control: (action: string, extra?: Record<string, unknown>) => Promise<void>;
  refreshStatus: () => void;
}

/**
 * Manages replay session listing, loading, and playback control.
 * @returns UseReplayResult
 */
export function useReplay(): UseReplayResult {
  const [session, setSession] = useState<ReplaySession | null>(null);
  const [sessions, setSessions] = useState<ReplaySession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const loadSession = useCallback(async (sessionId: string) => {
    await loadReplaySession(sessionId);
    await fetchData();
  }, [fetchData]);

  const control = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    await controlReplay({ action, ...extra });
    const status = await fetchReplayStatus();
    setSession(status);
  }, []);

  return { session, sessions, isLoading, error, loadSession, control, refreshStatus: fetchData };
}
