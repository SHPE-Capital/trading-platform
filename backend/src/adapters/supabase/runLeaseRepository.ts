/**
 * adapters/supabase/runLeaseRepository.ts
 *
 * Live-run leases (Part 05) over the 0011 RPC functions. Every lease decision
 * is a single conditional UPDATE evaluated against the database clock, so two
 * runners racing for the same run can never both win.
 */

import { getSupabaseClient } from "./client";
import { mapStrategyRun } from "./repositories";
import type { StrategyRun } from "../../types/strategy";
import type { UUID } from "../../types/common";

export async function acquireRunLease(runId: UUID, owner: string, leaseSeconds: number): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc("acquire_run_lease", {
    p_run: runId,
    p_owner: owner,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`acquire_run_lease failed: ${error.message}`);
  return data === true;
}

/** Takes every running run of this mode with no live lease, and returns them. */
export async function claimOrphanedRuns(
  owner: string,
  executionMode: string,
  runtimeOrigin: string,
  leaseSeconds: number,
): Promise<StrategyRun[]> {
  const { data, error } = await getSupabaseClient().rpc("claim_orphaned_runs", {
    p_owner: owner,
    p_execution_mode: executionMode,
    p_runtime_origin: runtimeOrigin,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`claim_orphaned_runs failed: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((row) =>
    mapStrategyRun({ ...row, name: (row.config as Record<string, unknown> | null)?.name ?? row.id }),
  );
}

/** Extends the given leases; returns the run ids still held by `owner`. */
export async function heartbeatRunLeases(owner: string, runIds: UUID[], leaseSeconds: number): Promise<UUID[]> {
  if (runIds.length === 0) return [];
  const { data, error } = await getSupabaseClient().rpc("heartbeat_run_leases", {
    p_owner: owner,
    p_runs: runIds,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`heartbeat_run_leases failed: ${error.message}`);
  // A setof-scalar RPC comes back as bare values or as single-key rows,
  // depending on PostgREST version.
  return ((data ?? []) as unknown[]).map((v) =>
    typeof v === "string" ? v : String(Object.values(v as Record<string, unknown>)[0]),
  );
}

export async function releaseRunLease(runId: UUID, owner: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc("release_run_lease", {
    p_run: runId,
    p_owner: owner,
  });
  if (error) throw new Error(`release_run_lease failed: ${error.message}`);
  return data === true;
}
