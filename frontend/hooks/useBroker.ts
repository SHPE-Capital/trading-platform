/**
 * hooks/useBroker.ts
 *
 * The account as the broker reports it, its equity history, and the ledger's
 * drift against it. Drift also arrives live as BROKER_DRIFT over /ws/events.
 * `unavailable` is true when the process serving the API holds no broker
 * connection — the dashboard then falls back to the runtime's own book.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchBrokerAccount,
  fetchBrokerDrift,
  fetchBrokerHistory,
  fetchBrokerPositions,
  type HistoryPeriod,
} from "../services/brokerService";
import { useWebSocket } from "./useWebSocket";
import type { BrokerAccount, BrokerHistoryPoint, BrokerPosition, DriftRow } from "../types/analytics";

interface DriftMsg {
  type: string;
  rows?: DriftRow[];
}

interface UseBrokerResult {
  account: BrokerAccount | null;
  positions: BrokerPosition[];
  history: BrokerHistoryPoint[];
  drift: DriftRow[];
  unavailable: boolean;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useBroker(period: HistoryPeriod = "1M", pollIntervalMs = 30_000): UseBrokerResult {
  const [account, setAccount] = useState<BrokerAccount | null>(null);
  const [positions, setPositions] = useState<BrokerPosition[]>([]);
  const [history, setHistory] = useState<BrokerHistoryPoint[]>([]);
  const [drift, setDrift] = useState<DriftRow[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { lastMessage } = useWebSocket<DriftMsg>("/ws/events");
  useEffect(() => {
    if (lastMessage?.type !== "BROKER_DRIFT" || !lastMessage.rows) return;
    const rows = lastMessage.rows;
    queueMicrotask(() => setDrift(rows));
  }, [lastMessage]);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [acct, pos, hist, dr] = await Promise.all([
        fetchBrokerAccount(),
        fetchBrokerPositions(),
        fetchBrokerHistory(period),
        fetchBrokerDrift(),
      ]);
      setAccount(acct);
      setPositions(pos);
      setHistory(hist);
      setDrift(dr.rows);
      setUnavailable(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load the broker account";
      if (message.includes("No broker connection")) setUnavailable(true);
      else setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => {
    queueMicrotask(() => void fetchData());
    if (pollIntervalMs <= 0) return;
    const interval = setInterval(fetchData, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchData, pollIntervalMs]);

  return { account, positions, history, drift, unavailable, isLoading, error, refetch: fetchData };
}
