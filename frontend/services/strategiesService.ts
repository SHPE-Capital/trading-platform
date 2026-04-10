/**
 * services/strategiesService.ts
 *
 * Frontend service for strategy management API calls.
 *
 * Inputs:  Strategy configs and run IDs.
 * Outputs: StrategyRun objects from the backend.
 */

import { apiGet, apiPost } from "./api";
import type { StrategyRun, PairsStrategyConfig } from "../types/strategy";

/**
 * Fetches all strategy run records.
 * @returns Array of StrategyRun objects
 */
export async function fetchStrategyRuns(): Promise<StrategyRun[]> {
  return apiGet<StrategyRun[]>("/strategies");
}

/**
 * Fetches a single strategy run by ID.
 * @param id - Strategy run UUID
 * @returns StrategyRun object
 */
export async function fetchStrategyRun(id: string): Promise<StrategyRun> {
  return apiGet<StrategyRun>(`/strategies/${id}`);
}

/**
 * Starts a new pairs trading strategy run.
 * @param config - PairsStrategyConfig
 * @returns { message: string, strategyId: string }
 */
export async function startPairsStrategy(
  config: Omit<PairsStrategyConfig, "id">,
): Promise<{ message: string; strategyId: string }> {
  return apiPost("/strategies/start", { strategyType: "pairs_trading", config });
}

/**
 * Stops a running strategy run.
 * @param id - Strategy run UUID
 */
export async function stopStrategyRun(id: string): Promise<void> {
  return apiPost(`/strategies/${id}/stop`, {});
}
