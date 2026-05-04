/**
 * services/strategiesService.ts
 *
 * Frontend service for strategy management API calls.
 *
 * Inputs:  Strategy configs and run IDs.
 * Outputs: StrategyRun and StoredStrategy objects from the backend.
 */

import { apiGet, apiPost, apiPut, apiDelete } from "./api";
import type { StrategyRun, PairsStrategyConfig, StoredStrategy, StrategyDefinition } from "../types/strategy";

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

// ------------------------------------------------------------------
// Strategy Config CRUD
// ------------------------------------------------------------------

/**
 * Fetches all saved strategy configs from the DB.
 * @returns Array of StoredStrategy rows
 */
export async function fetchStrategies(): Promise<StoredStrategy[]> {
  return apiGet<StoredStrategy[]>("/strategies/configs");
}

/**
 * Fetches the hardcoded default config for a strategy type.
 * @param type - Strategy type string (e.g. "pairs_trading")
 * @returns StrategyDefinition with label, description, version, and defaultConfig
 */
export async function fetchStrategyDefaults(type: string): Promise<StrategyDefinition> {
  return apiGet<StrategyDefinition>(`/strategies/configs/defaults/${type}`);
}

/**
 * Creates a new saved strategy config in the DB.
 * @param input - strategy_type, name, config
 * @returns The created StoredStrategy row
 */
export async function createStrategyConfig(input: {
  strategy_type: string;
  name: string;
  config: Record<string, unknown>;
}): Promise<StoredStrategy> {
  return apiPost<StoredStrategy>("/strategies/configs", input);
}

/**
 * Updates the name and config of a saved strategy (version unchanged).
 * @param id - Strategy config UUID
 * @param name - Updated name
 * @param config - Updated config object
 */
export async function updateStrategyConfig(
  id: string,
  name: string,
  config: Record<string, unknown>,
): Promise<void> {
  return apiPut(`/strategies/configs/${id}`, { name, config });
}

/**
 * Deletes a saved strategy config from the DB.
 * @param id - Strategy config UUID
 */
export async function deleteStrategyConfig(id: string): Promise<void> {
  return apiDelete(`/strategies/configs/${id}`);
}
