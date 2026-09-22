/**
 * services/backtestService.ts
 *
 * Frontend service for backtest API calls.
 *
 * Inputs:  BacktestConfig for triggering runs; backtest IDs for retrieval.
 * Outputs: BacktestResult objects from the backend API.
 */

import { apiGet, apiPost } from "./api";
import { config as appConfig } from "../config";
import type { BacktestConfig, BacktestResult } from "../types/api";

// Every call here targets the API-only process rather than the trading runtime.
// A trading process rejects backtest runs with 409: running one in-process would
// install a simulated clock over the live one and starve the broker WebSocket.
const BASE = appConfig.backtestApiBaseUrl;

/**
 * Fetches summaries of all past backtest results.
 * @returns Array of BacktestResult objects (without equity curve)
 */
export async function fetchBacktests(): Promise<BacktestResult[]> {
  return apiGet<BacktestResult[]>("/backtests", BASE);
}

/**
 * Fetches the full result for a single backtest by ID.
 * @param id - Backtest UUID
 * @returns Full BacktestResult including equity curve
 */
export async function fetchBacktest(id: string): Promise<BacktestResult> {
  return apiGet<BacktestResult>(`/backtests/${id}`, BASE);
}

/**
 * Triggers a new backtest run. Returns immediately with a backtestId.
 * @param config - BacktestConfig (without id)
 * @returns { backtestId: string, message: string }
 */
export async function runBacktest(
  config: Omit<BacktestConfig, "id">,
  force = false,
): Promise<{ backtestId: string; message: string }> {
  return apiPost("/backtests/run", force ? { ...config, force } : config, BASE);
}
