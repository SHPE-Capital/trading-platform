/**
 * services/brokerService.ts
 *
 * The account as the broker reports it — the source of truth for equity, cash
 * and positions — and the ledger's drift against it. Served by the trading
 * runtime, which holds the broker connection.
 */

import { apiGet } from "./api";
import type { BrokerAccount, BrokerHistoryPoint, BrokerPosition, DriftRow } from "../types/analytics";

export type HistoryPeriod = "1D" | "1W" | "1M" | "3M" | "1A";

/** A sensible bar size for each period. */
const TIMEFRAME: Record<HistoryPeriod, string> = { "1D": "5Min", "1W": "1H", "1M": "1D", "3M": "1D", "1A": "1D" };

export function fetchBrokerAccount(): Promise<BrokerAccount> {
  return apiGet<BrokerAccount>("/broker/account");
}

export function fetchBrokerPositions(): Promise<BrokerPosition[]> {
  return apiGet<BrokerPosition[]>("/broker/positions");
}

export function fetchBrokerHistory(period: HistoryPeriod): Promise<BrokerHistoryPoint[]> {
  return apiGet<BrokerHistoryPoint[]>(`/broker/history?period=${period}&timeframe=${TIMEFRAME[period]}`);
}

export function fetchBrokerDrift(): Promise<{ brokerAccount: string; rows: DriftRow[] }> {
  return apiGet<{ brokerAccount: string; rows: DriftRow[] }>("/broker/drift");
}
