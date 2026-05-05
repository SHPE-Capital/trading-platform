/**
 * hooks/usePortfolio.ts
 *
 * Custom React hook for fetching and managing portfolio state.
 * Polls the backend periodically for the latest snapshot and equity curve.
 *
 * Inputs:  Optional poll interval in milliseconds.
 * Outputs: { snapshot, equityCurve, isLoading, error, refetch }
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchPortfolioSnapshot, fetchEquityCurve } from "../services/portfolioService";
import { useWebSocket } from "./useWebSocket";
import type { PortfolioSnapshot } from "../types/portfolio";

interface PortfolioUpdatedMsg {
  type: string;
  payload: PortfolioSnapshot;
}

interface UsePortfolioResult {
  snapshot: PortfolioSnapshot | null;
  equityCurve: PortfolioSnapshot[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetches portfolio snapshot and equity curve on mount and at a configurable interval.
 * @param pollIntervalMs - How often to re-fetch in milliseconds (0 = no polling)
 * @returns UsePortfolioResult with snapshot, curve, loading state, and error
 */
export function usePortfolio(pollIntervalMs = 30_000): UsePortfolioResult {
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [equityCurve, setEquityCurve] = useState<PortfolioSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { lastMessage } = useWebSocket<PortfolioUpdatedMsg>("/ws/events");

  useEffect(() => {
    if (!lastMessage || lastMessage.type !== "PORTFOLIO_UPDATED") return;
    const snap = lastMessage.payload;
    setSnapshot(snap);
    setEquityCurve((prev) => {
      if (prev.length > 0 && prev[prev.length - 1]?.ts === snap.ts) return prev;
      return [...prev, snap];
    });
  }, [lastMessage]);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [snap, curve] = await Promise.all([
        fetchPortfolioSnapshot(),
        fetchEquityCurve(),
      ]);
      setSnapshot(snap);
      setEquityCurve(curve);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load portfolio");
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

  return { snapshot, equityCurve, isLoading, error, refetch: fetchData };
}
