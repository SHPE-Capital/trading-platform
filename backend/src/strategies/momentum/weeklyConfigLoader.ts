/**
 * strategies/momentum/weeklyConfigLoader.ts
 *
 * Parses and validates the weekly configuration artifact (0-A) and decides,
 * for a given session date, whether the strategy may open NEW positions.
 * Everything fails closed: a missing, stale, not-yet-active, invalid,
 * unknown-version or `no_deployment` artifact disables new entries. Open
 * positions are never affected here: the manager keeps the config they were
 * opened under, so their exits keep their protection.
 *
 * Pure and deterministic: no clock, file or network access. The caller passes
 * the raw artifact (already read from wherever it is stored) and the session
 * date, so replay and live resolve identically.
 *
 * Inputs:  unknown JSON value, session date "YYYY-MM-DD", flat flag.
 * Outputs: ParseResult, ConfigResolution.
 */

import { createHash } from "node:crypto";
import {
  WEEKLY_CONFIG_SCHEMA_VERSION,
  type AcceptanceCheck,
  type AccountSettings,
  type DateRange,
  type WeeklyConfig,
} from "./weeklyConfig";

export type ParseResult =
  | { ok: true; config: WeeklyConfig }
  | { ok: false; reason: "unknown_version" | "invalid"; errors: string[] };

type Obj = Record<string, unknown>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AWARE_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})$/;
const CONFIG_ID_RE = /^[0-9a-f]{16}$/;

class Checker {
  readonly errors: string[] = [];

  fail(path: string, msg: string): void {
    this.errors.push(`${path}: ${msg}`);
  }

  /** Checks keys against the schema's `additionalProperties: false`. */
  obj(v: unknown, path: string, required: string[], optional: string[] = []): Obj | null {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      this.fail(path, "must be an object");
      return null;
    }
    const o = v as Obj;
    for (const k of required) if (!(k in o)) this.fail(`${path}.${k}`, "is required");
    for (const k of Object.keys(o)) {
      if (!required.includes(k) && !optional.includes(k)) this.fail(`${path}.${k}`, "is not allowed");
    }
    return o;
  }

  str(v: unknown, path: string, minLength = 0): string {
    if (typeof v !== "string") {
      this.fail(path, "must be a string");
      return "";
    }
    if (v.length < minLength) this.fail(path, `must have at least ${minLength} characters`);
    return v;
  }

  num(v: unknown, path: string, min?: number): number {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      this.fail(path, "must be a finite number");
      return NaN;
    }
    if (min !== undefined && v < min) this.fail(path, `must be >= ${min}`);
    return v;
  }

  int(v: unknown, path: string, min?: number): number {
    const n = this.num(v, path, min);
    if (Number.isFinite(n) && !Number.isInteger(n)) this.fail(path, "must be an integer");
    return n;
  }

  bool(v: unknown, path: string): boolean {
    if (typeof v !== "boolean") {
      this.fail(path, "must be a boolean");
      return false;
    }
    return v;
  }

  /** Absent and null both read as null (the schema's `default: null`). */
  nullable<T>(o: Obj, key: string, path: string, read: (v: unknown, p: string) => T): T | null {
    const v = o[key];
    return v === undefined || v === null ? null : read(v, `${path}.${key}`);
  }

  date(v: unknown, path: string): string {
    const s = this.str(v, path);
    if (s === "") return s;
    const real = DATE_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
    if (!real) this.fail(path, "must be a calendar date YYYY-MM-DD");
    return s;
  }

  range(v: unknown, path: string): DateRange {
    const o = this.obj(v, path, ["start", "end"]);
    if (!o) return { start: "", end: "" };
    const start = this.date(o.start, `${path}.start`);
    const end = this.date(o.end, `${path}.end`);
    if (start !== "" && end !== "" && end < start) this.fail(path, "end must not be before start");
    return { start, end };
  }
}

function readAccount(c: Checker, v: unknown, path: string): AccountSettings {
  const o = c.obj(v, path, [
    "starting_cash", "max_positions", "per_stock_pct", "risk_pct", "total_exposure_cap", "liquidity_cap_pct",
    "liquidity_lookback", "liquidity_min_obs", "daily_halt_pct", "cost_bps", "ranking", "entry_score_threshold",
    "size_multiplier", "search_replay_reference_equity", "exit", "fill",
  ]) ?? {};
  const exit = c.obj(o.exit, `${path}.exit`, [
    "initial_stop_atr", "trail_activation_atr", "trail_distance_atr", "max_hold_minutes",
    "session_exit_minutes_before_close",
  ]) ?? {};
  const fill = c.obj(o.fill, `${path}.fill`, ["kind", "limit_markup"]) ?? {};
  const optNum = (key: string) => c.nullable(o, key, path, (x, p) => c.num(x, p));
  return {
    starting_cash: c.num(o.starting_cash, `${path}.starting_cash`),
    max_positions: c.int(o.max_positions, `${path}.max_positions`),
    per_stock_pct: c.num(o.per_stock_pct, `${path}.per_stock_pct`),
    risk_pct: c.num(o.risk_pct, `${path}.risk_pct`),
    total_exposure_cap: c.num(o.total_exposure_cap, `${path}.total_exposure_cap`),
    liquidity_cap_pct: c.num(o.liquidity_cap_pct, `${path}.liquidity_cap_pct`),
    liquidity_lookback: c.int(o.liquidity_lookback, `${path}.liquidity_lookback`),
    liquidity_min_obs: c.int(o.liquidity_min_obs, `${path}.liquidity_min_obs`),
    daily_halt_pct: c.num(o.daily_halt_pct, `${path}.daily_halt_pct`),
    cost_bps: c.num(o.cost_bps, `${path}.cost_bps`),
    ranking: c.str(o.ranking, `${path}.ranking`),
    entry_score_threshold: optNum("entry_score_threshold"),
    size_multiplier: optNum("size_multiplier"),
    search_replay_reference_equity: optNum("search_replay_reference_equity"),
    exit: {
      initial_stop_atr: c.num(exit.initial_stop_atr, `${path}.exit.initial_stop_atr`),
      trail_activation_atr: c.num(exit.trail_activation_atr, `${path}.exit.trail_activation_atr`),
      trail_distance_atr: c.num(exit.trail_distance_atr, `${path}.exit.trail_distance_atr`),
      max_hold_minutes: c.int(exit.max_hold_minutes, `${path}.exit.max_hold_minutes`),
      session_exit_minutes_before_close: c.int(
        exit.session_exit_minutes_before_close, `${path}.exit.session_exit_minutes_before_close`),
    },
    fill: {
      kind: c.str(fill.kind, `${path}.fill.kind`),
      limit_markup: c.num(fill.limit_markup, `${path}.fill.limit_markup`),
    },
  };
}

/**
 * 0-B config_id: first 16 hex chars of SHA-256 over the canonical JSON
 * (sorted keys, no spaces) of {v, subset (sorted), params}. Integral floats
 * collapse to ints, as in research (JS prints 1.0 as 1).
 */
export function computeConfigId(gridVersion: string, subset: readonly string[], params: Record<string, number>): string {
  const sortedParams: Record<string, number> = {};
  for (const k of Object.keys(params).sort()) sortedParams[k] = params[k];
  // Payload keys in sorted order: params, subset, v.
  const blob =
    `{"params":${JSON.stringify(sortedParams)},"subset":${JSON.stringify([...subset].sort())},` +
    `"v":${JSON.stringify(gridVersion)}}`;
  return createHash("sha256").update(blob, "utf8").digest("hex").slice(0, 16);
}

/** Validates a raw artifact. Never throws. An unknown `schema_version` is refused before anything else. */
export function parseWeeklyConfig(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "invalid", errors: ["artifact must be a JSON object"] };
  }
  const version = (raw as Obj).schema_version;
  if (version !== undefined && version !== WEEKLY_CONFIG_SCHEMA_VERSION) {
    return { ok: false, reason: "unknown_version", errors: [`unsupported schema_version ${JSON.stringify(version)}`] };
  }

  const c = new Checker();
  const o = c.obj(raw, "$", [
    "run_id", "code_commit", "data_version", "policy", "decision_cutoff", "search_range", "validation_range",
    "activation", "universe", "acceptance", "ess", "evaluations", "seeds", "account", "runtime",
  ], ["schema_version", "protocol_hash", "selected", "no_deployment"]) ?? {};

  const run_id = c.str(o.run_id, "$.run_id", 1);
  const code_commit = c.str(o.code_commit, "$.code_commit", 7);
  const data_version = c.str(o.data_version, "$.data_version", 1);
  const policy = o.policy;
  if (policy !== "uniform" && policy !== "recency" && policy !== "similarity") {
    c.fail("$.policy", "must be uniform, recency or similarity");
  }
  const cutoff = c.str(o.decision_cutoff, "$.decision_cutoff");
  if (cutoff !== "" && (!AWARE_DATETIME_RE.test(cutoff) || Number.isNaN(Date.parse(cutoff)))) {
    c.fail("$.decision_cutoff", "must be a timezone-aware ISO date-time");
  }
  const searchRange = c.range(o.search_range, "$.search_range");
  const validationRange = c.range(o.validation_range, "$.validation_range");
  const activation = c.range(o.activation, "$.activation");
  if (validationRange.start !== "" && searchRange.end !== "" && validationRange.start <= searchRange.end) {
    c.fail("$", "validation_range must start after search_range ends");
  }

  const universe: WeeklyConfig["universe"] = [];
  if (!Array.isArray(o.universe)) c.fail("$.universe", "must be an array");
  else {
    const seenAssets = new Set<string>();
    o.universe.forEach((m, i) => {
      const mo = c.obj(m, `$.universe[${i}]`, ["asset_id", "symbol"]);
      if (!mo) return;
      const asset_id = c.str(mo.asset_id, `$.universe[${i}].asset_id`, 1);
      const symbol = c.str(mo.symbol, `$.universe[${i}].symbol`, 1);
      if (seenAssets.has(asset_id)) c.fail(`$.universe[${i}].asset_id`, "duplicate asset_id");
      seenAssets.add(asset_id);
      universe.push({ asset_id, symbol });
    });
  }

  let selected: WeeklyConfig["selected"] = null;
  if (o.selected !== undefined && o.selected !== null) {
    const so = c.obj(o.selected, "$.selected", ["config_id", "grid_version", "subset", "params"]);
    if (so) {
      const config_id = c.str(so.config_id, "$.selected.config_id");
      if (!CONFIG_ID_RE.test(config_id)) c.fail("$.selected.config_id", "must be 16 lowercase hex characters");
      const grid_version = c.str(so.grid_version, "$.selected.grid_version");
      const subset: string[] = [];
      if (!Array.isArray(so.subset) || so.subset.length < 1) c.fail("$.selected.subset", "must be a non-empty array");
      else so.subset.forEach((s, i) => subset.push(c.str(s, `$.selected.subset[${i}]`)));
      const params: Record<string, number> = {};
      if (typeof so.params !== "object" || so.params === null || Array.isArray(so.params)) {
        c.fail("$.selected.params", "must be an object");
      } else {
        for (const [k, v] of Object.entries(so.params as Obj)) params[k] = c.num(v, `$.selected.params.${k}`);
      }
      if (subset.some((s, i) => i > 0 && subset[i - 1] >= s)) c.fail("$.selected.subset", "must be sorted and unique");
      const prefixes = new Set(Object.keys(params).map((k) => k.split(".")[0]));
      if (prefixes.size !== subset.length || subset.some((s) => !prefixes.has(s))) {
        c.fail("$.selected.params", "must cover exactly the active components");
      }
      selected = { config_id, grid_version, subset, params };
      if (c.errors.length === 0 && computeConfigId(grid_version, subset, params) !== config_id) {
        c.fail("$.selected.config_id", "does not match grid_version, subset and params");
      }
    }
  }

  let noDeployment: WeeklyConfig["no_deployment"] = null;
  if (o.no_deployment !== undefined && o.no_deployment !== null) {
    const no = c.obj(o.no_deployment, "$.no_deployment", ["reason"]);
    if (no) noDeployment = { reason: c.str(no.reason, "$.no_deployment.reason", 1) };
  }
  if ((selected === null) === (noDeployment === null)) {
    c.fail("$", "exactly one of 'selected' and 'no_deployment' must be set");
  }

  const checks: AcceptanceCheck[] = [];
  let acceptancePassed = false;
  const ao = c.obj(o.acceptance, "$.acceptance", ["passed", "checks"]);
  if (ao) {
    acceptancePassed = c.bool(ao.passed, "$.acceptance.passed");
    if (!Array.isArray(ao.checks)) c.fail("$.acceptance.checks", "must be an array");
    else ao.checks.forEach((k, i) => {
      const p = `$.acceptance.checks[${i}]`;
      const ko = c.obj(k, p, ["name", "passed"], ["value", "threshold"]);
      if (!ko) return;
      checks.push({
        name: c.str(ko.name, `${p}.name`),
        passed: c.bool(ko.passed, `${p}.passed`),
        value: c.nullable(ko, "value", p, (x, q) => c.num(x, q)),
        threshold: c.nullable(ko, "threshold", p, (x, q) => c.num(x, q)),
      });
    });
  }

  const eo = c.obj(o.evaluations, "$.evaluations", ["logical", "actual"]);
  const evaluations = {
    logical: c.int(eo?.logical, "$.evaluations.logical", 0),
    actual: c.int(eo?.actual, "$.evaluations.actual", 0),
  };
  const seeds: number[] = [];
  if (!Array.isArray(o.seeds)) c.fail("$.seeds", "must be an array");
  else o.seeds.forEach((s, i) => seeds.push(c.int(s, `$.seeds[${i}]`)));
  const account = readAccount(c, o.account, "$.account");
  const ro = c.obj(o.runtime, "$.runtime", ["seconds", "peak_memory_mb"]);
  const runtime = {
    seconds: c.num(ro?.seconds, "$.runtime.seconds", 0),
    peak_memory_mb: c.num(ro?.peak_memory_mb, "$.runtime.peak_memory_mb", 0),
  };
  const ess = c.num(o.ess, "$.ess", 0);
  const protocol_hash = c.nullable(o, "protocol_hash", "$", (v, p) => c.str(v, p));

  if (c.errors.length > 0) return { ok: false, reason: "invalid", errors: c.errors };
  return {
    ok: true,
    config: {
      schema_version: WEEKLY_CONFIG_SCHEMA_VERSION,
      run_id,
      code_commit,
      data_version,
      protocol_hash,
      policy: policy as WeeklyConfig["policy"],
      decision_cutoff: cutoff,
      search_range: searchRange,
      validation_range: validationRange,
      activation,
      universe,
      selected,
      no_deployment: noDeployment,
      acceptance: { passed: acceptancePassed, checks },
      ess,
      evaluations,
      seeds,
      account,
      runtime,
    },
  };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type EntriesDisabledReason =
  | "missing"
  | "invalid"
  | "unknown_version"
  | "not_yet_active"
  | "stale"
  | "no_deployment"
  | "acceptance_failed"
  | "switch_pending_not_flat";

export interface ConfigResolution {
  /** True only when new entries may be opened this session under `entryConfig`. */
  entriesAllowed: boolean;
  reason: EntriesDisabledReason | null;
  /** The config governing entries: set only when `entriesAllowed`. */
  entryConfig: WeeklyConfig | null;
  /** The config currently in force, which open positions' exits keep using; null when none is held. */
  protectionConfig: WeeklyConfig | null;
  /** Parse errors of the latest submission when it was refused. */
  errors: string[];
}

/** Why a parsed artifact cannot open entries on `sessionDate`, or null if it can. */
export function entriesBlockReason(config: WeeklyConfig, sessionDate: string): EntriesDisabledReason | null {
  if (sessionDate < config.activation.start) return "not_yet_active";
  if (sessionDate > config.activation.end) return "stale";
  if (config.no_deployment !== null || config.selected === null) return "no_deployment";
  if (!config.acceptance.passed) return "acceptance_failed";
  return null;
}

/**
 * Holds the latest submitted artifact and the config currently in force.
 *
 * - `submit()` records the newest artifact (or its absence or refusal). It
 *   never changes the config in force by itself.
 * - `resolve(sessionDate, flat)` adopts the latest valid artifact only while
 *   flat, so a position is never managed under a different config than it was
 *   opened with. While not flat and a different artifact is pending, entries
 *   are disabled (`switch_pending_not_flat`) and exits keep the config in force.
 * - While flat, a missing or invalid latest artifact drops the config in
 *   force: there is nothing left to protect.
 */
export class WeeklyConfigManager {
  private latest: ParseResult | null = null;
  private latestKey: string | null = null;
  private active: WeeklyConfig | null = null;
  private activeKey: string | null = null;

  /** `raw` null or undefined records a missing artifact. Returns the parse result. */
  submit(raw: unknown): ParseResult | null {
    this.latest = raw === null || raw === undefined ? null : parseWeeklyConfig(raw);
    // Fingerprint once here: resolve() runs on every bar of every symbol.
    this.latestKey = this.latest !== null && this.latest.ok ? JSON.stringify(this.latest.config) : null;
    return this.latest;
  }

  /** The config in force for open positions' protection (null if none adopted). */
  get activeConfig(): WeeklyConfig | null {
    return this.active;
  }

  resolve(sessionDate: string, flat: boolean): ConfigResolution {
    const latest = this.latest;
    const latestConfig = latest !== null && latest.ok ? latest.config : null;
    const errors = latest !== null && !latest.ok ? latest.errors : [];

    if (flat) {
      this.active = latestConfig;
      this.activeKey = this.latestKey;
    }
    const protectionConfig = this.active;
    const deny = (reason: EntriesDisabledReason): ConfigResolution => ({
      entriesAllowed: false, reason, entryConfig: null, protectionConfig, errors,
    });

    if (latest === null) return deny("missing");
    if (!latest.ok) return deny(latest.reason);
    if (this.active === null || this.activeKey !== this.latestKey) return deny("switch_pending_not_flat");
    const blocked = entriesBlockReason(latest.config, sessionDate);
    if (blocked !== null) return deny(blocked);
    return { entriesAllowed: true, reason: null, entryConfig: this.active, protectionConfig, errors };
  }
}
