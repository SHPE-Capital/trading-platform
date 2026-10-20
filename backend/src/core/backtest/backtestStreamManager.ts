/**
 * core/backtest/backtestStreamManager.ts
 *
 * The progress point a running backtest reports. The SSE stream that used to
 * live here (one database poll per second per open page) is gone: the browser
 * now follows the job row over Supabase Realtime (frontend
 * lib/watchBacktestJob.ts, publication added in migration 0019).
 */

import type { BacktestJobProgress } from "../../types/backtestJob";

/** Progress point shape the engine emits; the worker writes it to backtest_jobs.progress. */
export type BacktestProgressPoint = BacktestJobProgress;
