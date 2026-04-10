/**
 * services/backtestService.ts
 *
 * Frontend service for backtest API calls.
 *
 * Inputs:  BacktestConfig for triggering runs; backtest IDs for retrieval.
 * Outputs: BacktestResult objects from the backend API.
 */

import { apiGet, apiPost } from "./api";
import type { BacktestConfig, BacktestResult } from "../types/api";

/**
 * Fetches summaries of all past backtest results.
 * @returns Array of BacktestResult objects (without equity curve)
 */
export async function fetchBacktests(): Promise<BacktestResult[]> {
  return apiGet<BacktestResult[]>("/backtests");
}

/**
 * Fetches the full result for a single backtest by ID.
 * @param id - Backtest UUID
 * @returns Full BacktestResult including equity curve
 */
export async function fetchBacktest(id: string): Promise<BacktestResult> {
  return apiGet<BacktestResult>(`/backtests/${id}`);
}

/**
 * Triggers a new backtest run. Returns immediately with a backtestId.
 * @param config - BacktestConfig (without id)
 * @returns { backtestId: string, message: string }
 */
export async function runBacktest(
  config: Omit<BacktestConfig, "id">,
): Promise<{ backtestId: string; message: string }> {
  return apiPost("/backtests/run", config);
}
