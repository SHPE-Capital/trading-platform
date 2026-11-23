/**
 * app/controllers/momentumValidation.ts
 *
 * Strict validators for momentum artifacts. The weekly config validator mirrors
 * docs/contracts/weekly_config.v1.schema.json (additionalProperties false, same
 * required fields, enums and patterns); the results validator mirrors the E2
 * summary contract in frontend/features/momentum/results/types.ts. Both return
 * a list of errors, empty when valid, so callers fail closed.
 */

export interface WeeklyConfigV1 {
  schema_version?: "weekly_config.v1";
  run_id: string;
  code_commit: string;
  data_version: string;
  protocol_hash?: string | null;
  policy: "uniform" | "recency" | "similarity";
  decision_cutoff: string;
  search_range: { start: string; end: string };
  validation_range: { start: string; end: string };
  activation: { start: string; end: string };
  universe: { asset_id: string; symbol: string }[];
  selected?: { config_id: string; grid_version: string; subset: string[]; params: Record<string, number> } | null;
  no_deployment?: { reason: string } | null;
  acceptance: { passed: boolean; checks: { name: string; passed: boolean; value?: number | null; threshold?: number | null }[] };
  ess: number;
  evaluations: { logical: number; actual: number };
  seeds: number[];
  account: {
    daily_halt_pct: number;
    max_positions: number;
    exit: {
      initial_stop_atr: number;
      trail_activation_atr: number;
      trail_distance_atr: number;
      max_hold_minutes: number;
      session_exit_minutes_before_close: number;
    };
    [k: string]: unknown;
  };
  runtime: { seconds: number; peak_memory_mb: number };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(v: unknown): boolean {
  if (!isStr(v) || !DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
function isDateTime(v: unknown): boolean {
  return isStr(v) && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));
}

/** Checks that `o` is an object with only the allowed keys and every required key present. */
function shape(o: unknown, path: string, required: string[], optional: string[], errs: string[]): o is Obj {
  if (!isObj(o)) {
    errs.push(`${path}: expected object`);
    return false;
  }
  for (const k of required) if (!(k in o)) errs.push(`${path}.${k}: required`);
  const allowed = new Set([...required, ...optional]);
  for (const k of Object.keys(o)) if (!allowed.has(k)) errs.push(`${path}.${k}: unknown property`);
  return true;
}

function check(cond: boolean, msg: string, errs: string[]): void {
  if (!cond) errs.push(msg);
}

function dateRange(o: unknown, path: string, errs: string[]): void {
  if (!shape(o, path, ["start", "end"], [], errs)) return;
  check(isDate(o.start), `${path}.start: expected YYYY-MM-DD`, errs);
  check(isDate(o.end), `${path}.end: expected YYYY-MM-DD`, errs);
  if (isDate(o.start) && isDate(o.end)) check((o.start as string) <= (o.end as string), `${path}: start after end`, errs);
}

const numOrNull = (v: unknown): boolean => v === null || isNum(v);

export function validateWeeklyConfig(input: unknown): string[] {
  const errs: string[] = [];
  const req = [
    "run_id", "code_commit", "data_version", "policy", "decision_cutoff", "search_range", "validation_range",
    "activation", "universe", "acceptance", "ess", "evaluations", "seeds", "account", "runtime",
  ];
  const opt = ["schema_version", "protocol_hash", "selected", "no_deployment"];
  if (!shape(input, "$", req, opt, errs)) return errs;
  const o = input;

  // schema_version defaults to v1 in the schema, so absent is accepted; any other value is refused.
  check(o.schema_version === undefined || o.schema_version === "weekly_config.v1", "$.schema_version: must be weekly_config.v1", errs);
  check(isStr(o.run_id) && o.run_id.length >= 1, "$.run_id: non-empty string", errs);
  check(isStr(o.code_commit) && o.code_commit.length >= 7, "$.code_commit: string of at least 7 chars", errs);
  check(isStr(o.data_version) && o.data_version.length >= 1, "$.data_version: non-empty string", errs);
  check(o.protocol_hash === undefined || o.protocol_hash === null || isStr(o.protocol_hash), "$.protocol_hash: string or null", errs);
  check(o.policy === "uniform" || o.policy === "recency" || o.policy === "similarity", "$.policy: uniform|recency|similarity", errs);
  check(isDateTime(o.decision_cutoff), "$.decision_cutoff: expected date-time", errs);
  dateRange(o.search_range, "$.search_range", errs);
  dateRange(o.validation_range, "$.validation_range", errs);
  dateRange(o.activation, "$.activation", errs);

  if (!Array.isArray(o.universe)) errs.push("$.universe: expected array");
  else {
    o.universe.forEach((u, i) => {
      const p = `$.universe[${i}]`;
      if (!shape(u, p, ["asset_id", "symbol"], [], errs)) return;
      check(isStr(u.asset_id) && u.asset_id.length >= 1, `${p}.asset_id: non-empty string`, errs);
      check(isStr(u.symbol) && u.symbol.length >= 1, `${p}.symbol: non-empty string`, errs);
    });
  }

  const hasSel = o.selected !== undefined && o.selected !== null;
  const hasNo = o.no_deployment !== undefined && o.no_deployment !== null;
  if (hasSel) {
    const s = o.selected;
    if (shape(s, "$.selected", ["config_id", "grid_version", "subset", "params"], [], errs)) {
      check(isStr(s.config_id) && /^[0-9a-f]{16}$/.test(s.config_id), "$.selected.config_id: 16 lowercase hex chars", errs);
      check(isStr(s.grid_version), "$.selected.grid_version: string", errs);
      check(Array.isArray(s.subset) && s.subset.length >= 1 && s.subset.every(isStr), "$.selected.subset: non-empty string array", errs);
      check(isObj(s.params) && Object.values(s.params).every(isNum), "$.selected.params: object of numbers", errs);
    }
  }
  if (hasNo && shape(o.no_deployment, "$.no_deployment", ["reason"], [], errs)) {
    const r = (o.no_deployment as Obj).reason;
    check(isStr(r) && r.length >= 1, "$.no_deployment.reason: non-empty string", errs);
  }
  // A week either deploys one config or records why not; both or neither is ambiguous.
  check(hasSel !== hasNo, "$: exactly one of selected and no_deployment must be set", errs);

  if (shape(o.acceptance, "$.acceptance", ["passed", "checks"], [], errs)) {
    const a = o.acceptance as Obj;
    check(typeof a.passed === "boolean", "$.acceptance.passed: boolean", errs);
    if (!Array.isArray(a.checks)) errs.push("$.acceptance.checks: expected array");
    else {
      a.checks.forEach((c, i) => {
        const p = `$.acceptance.checks[${i}]`;
        if (!shape(c, p, ["name", "passed"], ["value", "threshold"], errs)) return;
        check(isStr(c.name), `${p}.name: string`, errs);
        check(typeof c.passed === "boolean", `${p}.passed: boolean`, errs);
        check(c.value === undefined || numOrNull(c.value), `${p}.value: number or null`, errs);
        check(c.threshold === undefined || numOrNull(c.threshold), `${p}.threshold: number or null`, errs);
      });
    }
  }

  check(isNum(o.ess) && o.ess >= 0, "$.ess: number >= 0", errs);
  if (shape(o.evaluations, "$.evaluations", ["logical", "actual"], [], errs)) {
    const e = o.evaluations as Obj;
    check(isInt(e.logical) && (e.logical as number) >= 0, "$.evaluations.logical: integer >= 0", errs);
    check(isInt(e.actual) && (e.actual as number) >= 0, "$.evaluations.actual: integer >= 0", errs);
  }
  check(Array.isArray(o.seeds) && o.seeds.every(isInt), "$.seeds: integer array", errs);

  const accountNums = ["starting_cash", "per_stock_pct", "risk_pct", "total_exposure_cap", "liquidity_cap_pct", "daily_halt_pct", "cost_bps"];
  const accountInts = ["max_positions", "liquidity_lookback", "liquidity_min_obs"];
  const accountNullable = ["entry_score_threshold", "size_multiplier", "search_replay_reference_equity"];
  if (shape(o.account, "$.account", [...accountNums, ...accountInts, ...accountNullable, "ranking", "exit", "fill"], [], errs)) {
    const a = o.account as Obj;
    for (const k of accountNums) check(isNum(a[k]), `$.account.${k}: number`, errs);
    for (const k of accountInts) check(isInt(a[k]), `$.account.${k}: integer`, errs);
    for (const k of accountNullable) check(numOrNull(a[k]), `$.account.${k}: number or null`, errs);
    check(isStr(a.ranking), "$.account.ranking: string", errs);
    const exitNums = ["initial_stop_atr", "trail_activation_atr", "trail_distance_atr"];
    const exitInts = ["max_hold_minutes", "session_exit_minutes_before_close"];
    if (shape(a.exit, "$.account.exit", [...exitNums, ...exitInts], [], errs)) {
      const x = a.exit as Obj;
      for (const k of exitNums) check(isNum(x[k]), `$.account.exit.${k}: number`, errs);
      for (const k of exitInts) check(isInt(x[k]), `$.account.exit.${k}: integer`, errs);
    }
    if (shape(a.fill, "$.account.fill", ["kind", "limit_markup"], [], errs)) {
      check(isStr((a.fill as Obj).kind), "$.account.fill.kind: string", errs);
      check(isNum((a.fill as Obj).limit_markup), "$.account.fill.limit_markup: number", errs);
    }
  }

  if (shape(o.runtime, "$.runtime", ["seconds", "peak_memory_mb"], [], errs)) {
    const r = o.runtime as Obj;
    check(isNum(r.seconds) && r.seconds >= 0, "$.runtime.seconds: number >= 0", errs);
    check(isNum(r.peak_memory_mb) && r.peak_memory_mb >= 0, "$.runtime.peak_memory_mb: number >= 0", errs);
  }
  return errs;
}

const POLICIES = ["similarity", "recency", "uniform"] as const;

export function validateResultsSummary(input: unknown): string[] {
  const errs: string[] = [];
  if (!shape(input, "$", ["meta", "policies", "equity", "paired", "costSensitivity", "weekly"], [], errs)) return errs;
  const o = input;

  if (shape(o.meta, "$.meta", ["strategy", "dataVersion", "costModel", "forwardPeriod", "generatedAt"], [], errs)) {
    const m = o.meta as Obj;
    for (const k of ["strategy", "dataVersion", "costModel"]) check(isStr(m[k]) && (m[k] as string).length > 0, `$.meta.${k}: non-empty string`, errs);
    check(isDateTime(m.generatedAt), "$.meta.generatedAt: expected date-time", errs);
    dateRange(m.forwardPeriod, "$.meta.forwardPeriod", errs);
  }

  if (!Array.isArray(o.policies) || o.policies.length === 0) errs.push("$.policies: non-empty array");
  else {
    const nums = [
      "cumulativeNetReturn", "endingEquity", "maxDrawdown", "avgDailyReturn", "downsideDeviation", "tradeCount", "activeDays",
      "noDeploymentWeeks", "avgHoldMinutes", "exposure", "turnover", "rejectedSignals", "calibrationRuntimeSeconds",
    ];
    o.policies.forEach((p, i) => {
      const path = `$.policies[${i}]`;
      if (!shape(p, path, ["policy", ...nums, "concentration"], [], errs)) return;
      check((POLICIES as readonly unknown[]).includes(p.policy), `${path}.policy: similarity|recency|uniform`, errs);
      for (const k of nums) check(isNum(p[k]), `${path}.${k}: number`, errs);
      if (shape(p.concentration, `${path}.concentration`, ["topWeeksShare", "topStocksShare"], [], errs)) {
        const c = p.concentration as Obj;
        check(isNum(c.topWeeksShare) && isNum(c.topStocksShare), `${path}.concentration: numbers`, errs);
      }
    });
  }

  if (!Array.isArray(o.equity)) errs.push("$.equity: expected array");
  else {
    o.equity.forEach((e, i) => {
      const path = `$.equity[${i}]`;
      if (!shape(e, path, ["date", ...POLICIES], [], errs)) return;
      check(isDate(e.date), `${path}.date: expected YYYY-MM-DD`, errs);
      for (const k of POLICIES) check(isNum(e[k]), `${path}.${k}: number`, errs);
    });
  }

  if (shape(o.paired, "$.paired", ["meanDaily", "nDays", "resamples", "intervals"], [], errs)) {
    const p = o.paired as Obj;
    check(isNum(p.meanDaily), "$.paired.meanDaily: number", errs);
    check(isInt(p.nDays) && isInt(p.resamples), "$.paired.nDays/resamples: integers", errs);
    if (!Array.isArray(p.intervals)) errs.push("$.paired.intervals: expected array");
    else {
      p.intervals.forEach((iv, i) => {
        const path = `$.paired.intervals[${i}]`;
        if (!shape(iv, path, ["blockLength", "primary", "lo", "hi"], [], errs)) return;
        check(isNum(iv.blockLength) && isNum(iv.lo) && isNum(iv.hi) && typeof iv.primary === "boolean",
          `${path}: blockLength/lo/hi numbers, primary boolean`, errs);
      });
    }
  }

  if (!Array.isArray(o.costSensitivity)) errs.push("$.costSensitivity: expected array");
  else {
    o.costSensitivity.forEach((r, i) => {
      const path = `$.costSensitivity[${i}]`;
      if (!shape(r, path, ["bps", ...POLICIES], [], errs)) return;
      check(isNum(r.bps) && POLICIES.every((k) => isNum(r[k])), `${path}: numbers`, errs);
    });
  }

  if (!Array.isArray(o.weekly)) errs.push("$.weekly: expected array");
  else {
    o.weekly.forEach((w, i) => {
      const path = `$.weekly[${i}]`;
      if (!shape(w, path, ["weekStart", ...POLICIES], [], errs)) return;
      check(isDate(w.weekStart), `${path}.weekStart: expected YYYY-MM-DD`, errs);
      for (const k of POLICIES) {
        const cp = `${path}.${k}`;
        if (!shape(w[k], cp, ["configId", "netReturn", "noDeploymentReason"], [], errs)) continue;
        const c = w[k] as Obj;
        check(c.configId === null || isStr(c.configId), `${cp}.configId: string or null`, errs);
        check(isNum(c.netReturn), `${cp}.netReturn: number`, errs);
        check(c.noDeploymentReason === null || isStr(c.noDeploymentReason), `${cp}.noDeploymentReason: string or null`, errs);
      }
    });
  }
  return errs;
}
