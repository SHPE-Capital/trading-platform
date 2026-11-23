/**
 * app/controllers/momentumController.ts
 *
 * Momentum dashboard API (P3-1): the active weekly config, live status, the
 * research results summary, and backend-only uploads of both artifacts.
 *
 * Fail closed: a missing, stale, invalid or out-of-week artifact reports entries
 * disabled with the reason, and an invalid stored payload is never returned.
 * Responses carry no credentials and no broker account details (spec §16).
 */

import type { Request, Response } from "express";
import {
  MomentumArtifactConflictError,
  findActiveWeeklyConfig,
  findLatestResultsSummary,
  findLatestWeeklyConfig,
  insertMomentumArtifact,
  type MomentumArtifactRow,
} from "../../adapters/supabase/momentumArtifactRepository";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { validateResultsSummary, validateWeeklyConfig, type WeeklyConfigV1 } from "./momentumValidation";

const POLICIES = ["uniform", "recency", "similarity"];
const HOUR_MS = 3_600_000;

/** Optional live data source; the paper/live runtime registers one when it is wired to the API. */
export interface MomentumRuntimeStatus {
  positions: {
    symbol: string; qty: number; entryPrice: number; lastPrice: number; stopPrice: number; enteredAt: string;
  }[];
  halt: { dayPnl: number; dayPnlPct: number; halted: boolean };
  lastBarAt: string | null;
}
let runtimeProvider: (() => Promise<MomentumRuntimeStatus | null>) | null = null;
export function setMomentumRuntimeProvider(p: (() => Promise<MomentumRuntimeStatus | null>) | null): void {
  runtimeProvider = p;
}

/** Why entries are disabled; null when enabled. */
export type EntriesDisabledCode =
  | "no_artifact"
  | "invalid_artifact"
  | "stale_artifact"
  | "outside_activation_week"
  | "no_deployment"
  | "daily_halt";

interface ResolvedConfig {
  config: WeeklyConfigV1 | null;
  row: MomentumArtifactRow | null;
  code: EntriesDisabledCode | null;
  reason: string | null;
}

const utcDate = (now: Date): string => now.toISOString().slice(0, 10);

function parsePolicy(req: Request): { policy?: string; error?: string } {
  const raw = req.query.policy;
  if (raw === undefined) return {};
  if (typeof raw !== "string" || !POLICIES.includes(raw)) return { error: `policy must be one of ${POLICIES.join(", ")}` };
  return { policy: raw };
}

/** Finds the config for today's session date and decides whether entries may open. */
async function resolveConfig(policy: string | undefined, now: Date): Promise<ResolvedConfig> {
  const active = await findActiveWeeklyConfig(utcDate(now), policy);
  if (!active) {
    const latest = await findLatestWeeklyConfig(policy);
    return latest
      ? { config: null, row: latest, code: "outside_activation_week", reason: "No weekly config is active for today's session date" }
      : { config: null, row: null, code: "no_artifact", reason: "No weekly config artifact has been uploaded" };
  }
  const errors = validateWeeklyConfig(active.payload);
  if (errors.length > 0) {
    logger.error("momentum: stored weekly config failed validation", { runId: active.run_id, errors: errors.slice(0, 5) });
    return { config: null, row: active, code: "invalid_artifact", reason: "Stored weekly config failed schema validation" };
  }
  const config = active.payload as WeeklyConfigV1;
  const ageHours = (now.getTime() - Date.parse(config.decision_cutoff)) / HOUR_MS;
  if (ageHours > env.momentumArtifactMaxAgeHours) {
    return { config, row: active, code: "stale_artifact", reason: `Weekly config is ${Math.floor(ageHours)}h old (limit ${env.momentumArtifactMaxAgeHours}h)` };
  }
  if (config.no_deployment) {
    return { config, row: active, code: "no_deployment", reason: config.no_deployment.reason };
  }
  return { config, row: active, code: null, reason: null };
}

/** Strips the stored artifact down to what the dashboard shows. */
function configView(r: ResolvedConfig, now: Date) {
  const c = r.config;
  if (!c || !r.row) return null;
  const ageHours = (now.getTime() - Date.parse(c.decision_cutoff)) / HOUR_MS;
  return {
    configId: c.selected?.config_id ?? null,
    runId: c.run_id,
    policy: c.policy,
    gridVersion: c.selected?.grid_version ?? null,
    subset: c.selected?.subset ?? [],
    params: c.selected?.params ?? {},
    activation: c.activation,
    decisionCutoff: c.decision_cutoff,
    artifactCreatedAt: r.row.created_at,
    dataVersion: c.data_version,
    freshness: {
      ageHours: Math.round(ageHours * 10) / 10,
      limitHours: env.momentumArtifactMaxAgeHours,
      stale: ageHours > env.momentumArtifactMaxAgeHours,
    },
    noDeploymentReason: c.no_deployment?.reason ?? null,
    exit: c.account.exit,
    risk: { dailyHaltPct: c.account.daily_halt_pct, maxPositions: c.account.max_positions },
    universe: { size: c.universe.length, symbols: c.universe.map((u) => u.symbol) },
  };
}

/** GET /api/momentum/config?policy= */
export async function getActiveConfig(req: Request, res: Response): Promise<void> {
  const p = parsePolicy(req);
  if (p.error) {
    res.status(400).json({ error: p.error });
    return;
  }
  try {
    const now = new Date();
    const r = await resolveConfig(p.policy, now);
    res.json({
      asOf: now.toISOString(),
      active: r.config !== null,
      config: configView(r, now),
      entries: { enabled: r.code === null, code: r.code, reason: r.reason },
    });
  } catch (err) {
    logger.error("getActiveConfig error", { err: String(err) });
    res.status(500).json({ error: "Failed to load momentum config" });
  }
}

/** GET /api/momentum/status?policy= */
export async function getLiveStatus(req: Request, res: Response): Promise<void> {
  const p = parsePolicy(req);
  if (p.error) {
    res.status(400).json({ error: p.error });
    return;
  }
  try {
    const now = new Date();
    const r = await resolveConfig(p.policy, now);
    let runtime: MomentumRuntimeStatus | null = null;
    if (runtimeProvider) {
      try {
        runtime = await runtimeProvider();
      } catch (err) {
        logger.error("momentum runtime provider failed", { err: String(err) });
      }
    }
    let { code, reason } = r;
    if (code === null && runtime?.halt.halted) {
      code = "daily_halt";
      reason = "Daily loss halt is active";
    }
    res.json({
      asOf: now.toISOString(),
      config: configView(r, now),
      entries: { enabled: code === null, code, reason },
      runtimeConnected: runtime !== null,
      positions: runtime?.positions ?? [],
      halt: {
        haltPct: r.config?.account.daily_halt_pct ?? null,
        dayPnl: runtime?.halt.dayPnl ?? null,
        dayPnlPct: runtime?.halt.dayPnlPct ?? null,
        halted: runtime?.halt.halted ?? false,
      },
      lastBarAt: runtime?.lastBarAt ?? null,
    });
  } catch (err) {
    logger.error("getLiveStatus error", { err: String(err) });
    res.status(500).json({ error: "Failed to load momentum status" });
  }
}

/** GET /api/momentum/results/summary — the E2 summary exactly as uploaded. */
export async function getResultsSummary(_req: Request, res: Response): Promise<void> {
  try {
    const row = await findLatestResultsSummary();
    if (!row) {
      res.status(404).json({ error: "No research results summary has been uploaded" });
      return;
    }
    const errors = validateResultsSummary(row.payload);
    if (errors.length > 0) {
      logger.error("momentum: stored results summary failed validation", { runId: row.run_id, errors: errors.slice(0, 5) });
      res.status(500).json({ error: "Stored research results summary is invalid" });
      return;
    }
    res.json(row.payload);
  } catch (err) {
    logger.error("getResultsSummary error", { err: String(err) });
    res.status(500).json({ error: "Failed to load research results" });
  }
}

/** POST /api/momentum/artifacts/weekly-config (ingest token) */
export async function postWeeklyConfig(req: Request, res: Response): Promise<void> {
  const errors = validateWeeklyConfig(req.body);
  if (errors.length > 0) {
    res.status(422).json({ error: "Invalid weekly config artifact", details: errors.slice(0, 20) });
    return;
  }
  const c = req.body as WeeklyConfigV1;
  try {
    const row = await insertMomentumArtifact({
      kind: "weekly_config",
      runId: c.run_id,
      policy: c.policy,
      activationStart: c.activation.start,
      activationEnd: c.activation.end,
      payload: c,
    });
    res.status(201).json({ id: row.id, runId: row.run_id, createdAt: row.created_at });
  } catch (err) {
    if (err instanceof MomentumArtifactConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    logger.error("postWeeklyConfig error", { err: String(err) });
    res.status(500).json({ error: "Failed to store weekly config" });
  }
}

/** POST /api/momentum/results/summary (ingest token) */
export async function postResultsSummary(req: Request, res: Response): Promise<void> {
  const errors = validateResultsSummary(req.body);
  if (errors.length > 0) {
    res.status(422).json({ error: "Invalid research results summary", details: errors.slice(0, 20) });
    return;
  }
  const s = req.body as { meta: { dataVersion: string; generatedAt: string } };
  // One summary per data version and generation time, so a re-run never overwrites an earlier one.
  const runId = `${s.meta.dataVersion}@${s.meta.generatedAt}`;
  try {
    const row = await insertMomentumArtifact({ kind: "results_summary", runId, payload: req.body });
    res.status(201).json({ id: row.id, runId: row.run_id, createdAt: row.created_at });
  } catch (err) {
    if (err instanceof MomentumArtifactConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    logger.error("postResultsSummary error", { err: String(err) });
    res.status(500).json({ error: "Failed to store research results" });
  }
}
