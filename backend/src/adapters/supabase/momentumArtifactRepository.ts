/**
 * adapters/supabase/momentumArtifactRepository.ts
 *
 * Storage for momentum weekly config artifacts and research results summaries
 * (table from 0021). Rows are immutable: a second upload of the same run is a
 * conflict, never an overwrite. Payloads are validated before insert and
 * re-validated by the reader, so a hand-edited row fails closed.
 */

import { getSupabaseClient } from "./client";

export type MomentumArtifactKind = "weekly_config" | "results_summary";

export interface MomentumArtifactRow {
  id: string;
  kind: MomentumArtifactKind;
  run_id: string;
  policy: string | null;
  activation_start: string | null;
  activation_end: string | null;
  payload: unknown;
  created_at: string;
}

export interface NewMomentumArtifact {
  kind: MomentumArtifactKind;
  runId: string;
  policy?: string | null;
  activationStart?: string | null;
  activationEnd?: string | null;
  payload: unknown;
}

const COLUMNS = "id, kind, run_id, policy, activation_start, activation_end, payload, created_at";
const UNIQUE_VIOLATION = "23505";

export class MomentumArtifactConflictError extends Error {
  constructor(kind: string, runId: string) {
    super(`${kind} artifact for run ${runId} already exists`);
  }
}

/** Inserts an artifact; throws MomentumArtifactConflictError when the run was already uploaded. */
export async function insertMomentumArtifact(a: NewMomentumArtifact): Promise<MomentumArtifactRow> {
  const { data, error } = await getSupabaseClient()
    .from("momentum_artifacts")
    .insert({
      kind: a.kind,
      run_id: a.runId,
      policy: a.policy ?? null,
      activation_start: a.activationStart ?? null,
      activation_end: a.activationEnd ?? null,
      payload: a.payload,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new MomentumArtifactConflictError(a.kind, a.runId);
    throw new Error(`insertMomentumArtifact failed: ${error.message}`);
  }
  return data as MomentumArtifactRow;
}

/** Newest weekly config whose activation week contains `date` (YYYY-MM-DD), optionally for one policy. */
export async function findActiveWeeklyConfig(date: string, policy?: string): Promise<MomentumArtifactRow | null> {
  let q = getSupabaseClient()
    .from("momentum_artifacts")
    .select(COLUMNS)
    .eq("kind", "weekly_config")
    .lte("activation_start", date)
    .gte("activation_end", date);
  if (policy) q = q.eq("policy", policy);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error(`findActiveWeeklyConfig failed: ${error.message}`);
  return ((data ?? [])[0] as MomentumArtifactRow | undefined) ?? null;
}

/** Newest weekly config of any week, used to explain why nothing is active. */
export async function findLatestWeeklyConfig(policy?: string): Promise<MomentumArtifactRow | null> {
  let q = getSupabaseClient().from("momentum_artifacts").select(COLUMNS).eq("kind", "weekly_config");
  if (policy) q = q.eq("policy", policy);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error(`findLatestWeeklyConfig failed: ${error.message}`);
  return ((data ?? [])[0] as MomentumArtifactRow | undefined) ?? null;
}

/** Newest research results summary. */
export async function findLatestResultsSummary(): Promise<MomentumArtifactRow | null> {
  const { data, error } = await getSupabaseClient()
    .from("momentum_artifacts")
    .select(COLUMNS)
    .eq("kind", "results_summary")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`findLatestResultsSummary failed: ${error.message}`);
  return ((data ?? [])[0] as MomentumArtifactRow | undefined) ?? null;
}
