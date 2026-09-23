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

// Backtests run in worker processes; every call here only talks to the control
// plane. The API-only process is the natural host for that traffic, which keeps
// it off the trading runtime's event loop.
const BASE = appConfig.backtestApiBaseUrl;

/** Response from POST /backtests/run. */
export interface RunBacktestResponse {
  backtestId: string;
  message: string;
  /** "succeeded" means an identical earlier result was returned — nothing to wait for. */
  status: "queued" | "running" | "succeeded";
  /** An identical earlier result (saved, or still in its save window) was reused. */
  reused?: boolean;
  /** Joined an identical run already queued or running. */
  deduped?: boolean;
}

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
 * Queues a backtest for a worker. Returns immediately with a backtestId to
 * stream; with force=false an identical earlier result may be returned instead.
 * @param config - BacktestConfig (without id)
 */
export async function runBacktest(
  config: Omit<BacktestConfig, "id">,
  force = false,
): Promise<RunBacktestResponse> {
  return apiPost("/backtests/run", force ? { ...config, force } : config, BASE);
}

/**
 * Explicitly persists a completed run — nothing is written to the saved results
 * until this is called. A finished run stays saveable for a limited window
 * (result_expires_at); past that this call 404s and the backtest must be
 * re-run to save it. Idempotent: saving an already-saved id just confirms it.
 * @param id - Backtest UUID (the one returned by runBacktest / the SSE complete event)
 * @returns { id, alreadySaved }
 */
export async function saveBacktest(id: string): Promise<{ id: string; alreadySaved: boolean }> {
  return apiPost(`/backtests/${id}/save`, {}, BASE);
}
