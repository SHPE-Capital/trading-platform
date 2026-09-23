/**
 * services/governanceService.ts
 *
 * Shared-book governance views. Targets the default API base: persisted
 * rejections come from the trading runtimes but are read from the database, so
 * any API process can serve them.
 */

import { apiGet } from "./api";

export interface ContentionRow {
  ownerId: string | null;
  ownerName: string | null;
  strategyId: string | null;
  strategyName: string | null;
  /** STRATEGY_BUDGET, CAPITAL_UNAVAILABLE, CASH_RESERVE, ORDER_COOLDOWN, ... */
  failedCheck: string;
  rejections: number;
  lastAt: number;
}

export interface ContentionSummary {
  days: number;
  rows: ContentionRow[];
}

export async function fetchContention(days: number): Promise<ContentionSummary> {
  return apiGet<ContentionSummary>(`/governance/contention?days=${days}`);
}
