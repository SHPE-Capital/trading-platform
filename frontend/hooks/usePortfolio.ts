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
import { usePolling } from "./usePolling";
import { fetchPortfolioSnapshot, fetchEquityCurve } from "../services/portfolioService";
import { useWebSocket } from "./useWebSocket";
import type { EquityPoint, PortfolioSnapshot } from "../types/portfolio";

interface PortfolioUpdatedMsg {
  type: string;
  payload: PortfolioSnapshot;
}

interface UsePortfolioResult {
  snapshot: PortfolioSnapshot | null;
  equityCurve: EquityPoint[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetches portfolio snapshot and equity curve on mount and at a configurable interval.
 * @param pollIntervalMs - How often to re-fetch in milliseconds (0 = no polling)
 * @returns UsePortfolioResult with snapshot, curve, loading state, and error
 */
const CURVE_REFRESH_MS = 5 * 60_000;

export function usePortfolio(pollIntervalMs = 30_000): UsePortfolioResult {
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([]);
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

  const fetchSnapshot = useCallback(async () => {
    try {
      setError(null);
      setSnapshot(await fetchPortfolioSnapshot());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load portfolio");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // The curve grows by live WebSocket points between reloads, so the full
  // history only needs re-reading every few minutes.
  const fetchCurve = useCallback(async () => {
    try {
      setEquityCurve(await fetchEquityCurve());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load portfolio");
    }
  }, []);

  usePolling(fetchSnapshot, pollIntervalMs);
  usePolling(fetchCurve, pollIntervalMs > 0 ? CURVE_REFRESH_MS : 0);

  const fetchData = useCallback(async () => {
    await Promise.all([fetchSnapshot(), fetchCurve()]);
  }, [fetchSnapshot, fetchCurve]);

  return { snapshot, equityCurve, isLoading, error, refetch: fetchData };
}
