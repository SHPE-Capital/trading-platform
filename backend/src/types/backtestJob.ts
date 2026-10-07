/**
 * types/backtestJob.ts
 *
 * The durable backtest queue (Part 02, migrations 0001 / 0011). A job row is
 * the single shared channel between the API processes that accept runs and
 * stream progress, and the worker processes that execute them.
 */

import type { UUID, EpochMs } from "./common";
import type { BacktestConfig } from "./backtest";

export type BacktestJobStatus = "queued" | "running" | "succeeded" | "failed";

/** Latest progress point, written by the worker at most ~1/s. */
export interface BacktestJobProgress {
  /** Simulated bar timestamp (Unix ms) */
  ts: EpochMs;
  equity: number;
  barIndex: number;
  totalBars: number;
}

export interface BacktestJob {
  id: UUID;
  configKey: string;
  config: BacktestConfig;
  status: BacktestJobStatus;
  leaseOwner: string | null;
  leaseExpiresAt: EpochMs | null;
  resultId: UUID | null;
  errorMessage: string | null;
  attempts: number;
  requestedBy: UUID | null;
  runtimeOrigin?: string;
  buildSha?: string;
  buildDirty?: boolean;
  progress: BacktestJobProgress | null;
  createdAt: EpochMs;
  startedAt: EpochMs | null;
  finishedAt: EpochMs | null;
  /** When a succeeded job's staged result stops being saveable. */
  resultExpiresAt: EpochMs | null;
}

export interface EnqueueResult {
  jobId: UUID;
  status: BacktestJobStatus;
  /** True when an identical run was already queued or running and was reused. */
  deduped: boolean;
}
