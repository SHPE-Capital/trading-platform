/**
 * adapters/supabase/backtestJobRepository.ts
 *
 * Database access for the durable backtest queue (Part 02). Queue transitions
 * that must be atomic or must use the database clock (claim, heartbeat,
 * complete, fail, release, sweep) go through the RPC functions in 0011; plain
 * reads and the enqueue insert use the table directly.
 *
 * A finished run's output is staged in backtest_job_artifacts until a member
 * saves it (0009: backtest_results holds saved runs only) or its save window
 * closes and sweep_backtest_jobs drops it.
 */

import { getSupabaseClient } from "./client";
import { logger } from "../../utils/logger";
import type { UUID } from "../../types/common";
import type { BacktestConfig, BacktestResult } from "../../types/backtest";
import type {
  BacktestJob,
  BacktestJobProgress,
  BacktestJobStatus,
  EnqueueResult,
} from "../../types/backtestJob";
import { env } from "../../config/env";

/** Orders/fills per staged artifact row — matches the save path's insert chunking. */
const ARTIFACT_CHUNK = 1_000;
/** Artifact rows per read: each can hold a thousand orders, so keep pages small. */
const ARTIFACT_READ_PAGE = 20;
const UNIQUE_VIOLATION = "23505";

function msOrNull(value: unknown): number | null {
  return value ? new Date(value as string).getTime() : null;
}

function mapJob(row: Record<string, unknown>): BacktestJob {
  return {
    id: row.id as UUID,
    configKey: row.config_key as string,
    config: row.config as BacktestConfig,
    status: row.status as BacktestJobStatus,
    leaseOwner: (row.lease_owner as string | null) ?? null,
    leaseExpiresAt: msOrNull(row.lease_expires_at),
    resultId: (row.result_id as UUID | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    attempts: Number(row.attempts ?? 0),
    requestedBy: (row.requested_by as UUID | null) ?? null,
    runtimeOrigin: (row.runtime_origin as string | undefined) ?? "legacy",
    buildSha: (row.build_sha as string | undefined) ?? "unknown",
    buildDirty: (row.build_dirty as boolean | undefined) ?? false,
    progress: (row.progress as BacktestJobProgress | null) ?? null,
    createdAt: new Date(row.created_at as string).getTime(),
    startedAt: msOrNull(row.started_at),
    finishedAt: msOrNull(row.finished_at),
    resultExpiresAt: msOrNull(row.result_expires_at),
  };
}

// ------------------------------------------------------------------
// API side
// ------------------------------------------------------------------

/**
 * Queues a run. The partial unique index on config_key (0001) allows one live
 * job per fingerprint across every API replica, so a concurrent identical
 * request gets the job already in flight instead of starting a second run.
 */
export async function enqueueBacktestJob(input: {
  id: UUID;
  configKey: string;
  config: BacktestConfig;
  requestedBy: UUID | null;
}): Promise<EnqueueResult> {
  const supabase = getSupabaseClient();

  // Retried because the conflicting job can finish between our failed insert
  // and the lookup, leaving nothing to join — at which point inserting wins.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supabase.from("backtest_jobs").insert({
      id: input.id,
      config_key: input.configKey,
      config: input.config,
      strategy_version: input.config.strategyVersion ?? null,
      requested_by: input.requestedBy,
      runtime_origin: env.runtimeOrigin,
      build_sha: env.buildSha,
      build_dirty: env.buildDirty,
    });
    if (!error) return { jobId: input.id, status: "queued", deduped: false };
    if (error.code !== UNIQUE_VIOLATION) {
      throw new Error(`enqueueBacktestJob failed: ${error.message}`);
    }

    const { data, error: lookupError } = await supabase
      .from("backtest_jobs")
      .select("id, status")
      .eq("config_key", input.configKey)
      .eq("runtime_origin", env.runtimeOrigin)
      .in("status", ["queued", "running"])
      .maybeSingle();
    if (lookupError) throw new Error(`enqueueBacktestJob lookup failed: ${lookupError.message}`);
    if (data) {
      return { jobId: data.id as UUID, status: data.status as BacktestJobStatus, deduped: true };
    }
  }
  throw new Error("enqueueBacktestJob: could not insert or join an identical job");
}

export async function getBacktestJob(id: UUID): Promise<BacktestJob | null> {
  const { data, error } = await getSupabaseClient()
    .from("backtest_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getBacktestJob failed: ${error.message}`);
  return data ? mapJob(data as Record<string, unknown>) : null;
}

/**
 * Most recent succeeded job for this fingerprint whose staged result is still
 * saveable — an identical run someone just did, served instead of re-running.
 */
export async function findReusableJob(configKey: string): Promise<BacktestJob | null> {
  const { data, error } = await getSupabaseClient()
    .from("backtest_jobs")
    .select("*")
    .eq("config_key", configKey)
    .eq("runtime_origin", env.runtimeOrigin)
    .eq("status", "succeeded")
    .gt("result_expires_at", new Date().toISOString())
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.warn("findReusableJob failed", { error: error.message });
    return null;
  }
  return data ? mapJob(data as Record<string, unknown>) : null;
}

/** The staged result minus orders/fills — what the results view renders. */
export async function readJobSummary(jobId: UUID): Promise<BacktestResult | null> {
  const job = await getBacktestJob(jobId);
  if (!job || job.status !== "succeeded" || !job.resultExpiresAt || job.resultExpiresAt < Date.now()) {
    return null;
  }
  const { data, error } = await getSupabaseClient()
    .from("backtest_job_artifacts")
    .select("payload")
    .eq("job_id", jobId)
    .eq("kind", "summary")
    .maybeSingle();
  if (error) throw new Error(`readJobSummary failed: ${error.message}`);
  if (!data) return null;
  return { ...(data.payload as BacktestResult), result_expires_at: job.resultExpiresAt } as BacktestResult;
}

/** The full staged result, orders and fills included — what a save persists. */
export async function readJobResultFull(jobId: UUID): Promise<BacktestResult | null> {
  const summary = await readJobSummary(jobId);
  if (!summary) return null;
  const [orders, fills] = await Promise.all([
    readArtifactItems(jobId, "orders"),
    readArtifactItems(jobId, "fills"),
  ]);
  return { ...summary, orders, fills } as BacktestResult;
}

async function readArtifactItems(jobId: UUID, kind: "orders" | "fills"): Promise<unknown[]> {
  const supabase = getSupabaseClient();
  const items: unknown[] = [];
  for (let offset = 0; ; offset += ARTIFACT_READ_PAGE) {
    const { data, error } = await supabase
      .from("backtest_job_artifacts")
      .select("payload")
      .eq("job_id", jobId)
      .eq("kind", kind)
      .order("seq", { ascending: true })
      .range(offset, offset + ARTIFACT_READ_PAGE - 1);
    if (error) throw new Error(`readArtifactItems(${kind}) failed: ${error.message}`);
    for (const row of data ?? []) items.push(...(row.payload as unknown[]));
    if (!data || data.length < ARTIFACT_READ_PAGE) return items;
  }
}

/** Frees a job's staged output once it has been saved to backtest_results. */
export async function deleteJobArtifacts(jobId: UUID): Promise<void> {
  const { error } = await getSupabaseClient().from("backtest_job_artifacts").delete().eq("job_id", jobId);
  if (error) throw new Error(`deleteJobArtifacts failed: ${error.message}`);
}

// ------------------------------------------------------------------
// Worker side
// ------------------------------------------------------------------

export interface ClaimOptions {
  leaseSeconds: number;
  maxAttempts: number;
  perUserCap: number;
}

export async function claimBacktestJob(workerId: string, opts: ClaimOptions): Promise<BacktestJob | null> {
  const { data, error } = await getSupabaseClient().rpc("claim_backtest_job", {
    p_worker: workerId,
    p_lease_seconds: opts.leaseSeconds,
    p_max_attempts: opts.maxAttempts,
    p_per_user_cap: opts.perUserCap,
    p_runtime_origin: env.runtimeOrigin,
  });
  if (error) throw new Error(`claim_backtest_job failed: ${error.message}`);
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.length > 0 ? mapJob(rows[0]) : null;
}

/** Heartbeat, optionally carrying progress. False = this worker lost the lease. */
export async function touchBacktestJob(
  jobId: UUID,
  workerId: string,
  leaseSeconds: number,
  progress: BacktestJobProgress | null,
): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc("touch_backtest_job", {
    p_job: jobId,
    p_worker: workerId,
    p_lease_seconds: leaseSeconds,
    p_progress: progress,
  });
  if (error) throw new Error(`touch_backtest_job failed: ${error.message}`);
  return data === true;
}

export async function completeBacktestJob(jobId: UUID, workerId: string, resultTtlSeconds: number): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc("complete_backtest_job", {
    p_job: jobId,
    p_worker: workerId,
    p_result_ttl_seconds: resultTtlSeconds,
  });
  if (error) throw new Error(`complete_backtest_job failed: ${error.message}`);
  return data === true;
}

export async function failBacktestJob(jobId: UUID, workerId: string, message: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc("fail_backtest_job", {
    p_job: jobId,
    p_worker: workerId,
    p_error: message,
  });
  if (error) throw new Error(`fail_backtest_job failed: ${error.message}`);
  return data === true;
}

export async function releaseBacktestJob(jobId: UUID, workerId: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc("release_backtest_job", {
    p_job: jobId,
    p_worker: workerId,
  });
  if (error) throw new Error(`release_backtest_job failed: ${error.message}`);
  return data === true;
}

export async function sweepBacktestJobs(keepFinishedHours: number): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc("sweep_backtest_jobs", {
    p_keep_finished_hours: keepFinishedHours,
  });
  if (error) throw new Error(`sweep_backtest_jobs failed: ${error.message}`);
  return Number(data ?? 0);
}

/**
 * Stages a finished run. Upserted, so a worker that lost its lease at the last
 * moment and the worker that reclaimed the job can both write — a backtest is
 * deterministic, so both write the same thing.
 */
export async function writeJobArtifacts(jobId: UUID, result: BacktestResult): Promise<void> {
  const { orders = [], fills = [], ...summary } = result;
  const rows: { job_id: UUID; kind: string; seq: number; payload: unknown }[] = [
    { job_id: jobId, kind: "summary", seq: 0, payload: summary },
  ];
  for (let i = 0; i < orders.length; i += ARTIFACT_CHUNK) {
    rows.push({ job_id: jobId, kind: "orders", seq: i / ARTIFACT_CHUNK, payload: orders.slice(i, i + ARTIFACT_CHUNK) });
  }
  for (let i = 0; i < fills.length; i += ARTIFACT_CHUNK) {
    rows.push({ job_id: jobId, kind: "fills", seq: i / ARTIFACT_CHUNK, payload: fills.slice(i, i + ARTIFACT_CHUNK) });
  }

  const supabase = getSupabaseClient();
  // One artifact per request: each already holds up to a thousand orders.
  for (const row of rows) {
    const { error } = await supabase
      .from("backtest_job_artifacts")
      .upsert(row, { onConflict: "job_id,kind,seq" });
    if (error) throw new Error(`writeJobArtifacts(${row.kind}#${row.seq}) failed: ${error.message}`);
  }
}
