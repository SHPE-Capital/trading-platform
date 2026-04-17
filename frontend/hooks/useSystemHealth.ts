/**
 * hooks/useSystemHealth.ts
 *
 * Custom React hook for polling the backend system health endpoint.
 * Returns per-service connectivity status and any error messages.
 *
 * Inputs:  Optional poll interval in milliseconds.
 * Outputs: { status, isLoading, error, refetch }
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchSystemStatus } from "../services/systemService";
import type { SystemStatus } from "../types/api";

interface UseSystemHealthResult {
  status: SystemStatus | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSystemHealth(pollIntervalMs = 30_000): UseSystemHealthResult {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchSystemStatus();
      setStatus({
        ...data,
        services: { ...data.services, backend: { health: true } },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Cannot reach backend server";
      setStatus({
        status: "unhealthy",
        services: {
          backend:  { health: false, error: message },
          supabase: { health: false, error: "Unknown (backend unreachable)" },
          alpaca:   { health: false, error: "Unknown (backend unreachable)" },
        },
        mode: "unknown",
        ts: new Date().toISOString(),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    if (pollIntervalMs <= 0) return;
    const interval = setInterval(fetchData, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchData, pollIntervalMs]);

  return { status, isLoading, error, refetch: fetchData };
}
