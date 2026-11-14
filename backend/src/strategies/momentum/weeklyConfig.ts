/**
 * strategies/momentum/weeklyConfig.ts
 *
 * TypeScript mirror of the weekly configuration artifact (contract 0-A,
 * research-python docs/contracts/weekly_config.v1.schema.json). Field names are
 * the artifact's own snake_case so a parsed artifact is the typed object, with
 * no renaming layer to drift.
 *
 * Inputs:  none (types only).
 * Outputs: WeeklyConfig and its parts.
 */

export const WEEKLY_CONFIG_SCHEMA_VERSION = "weekly_config.v1";

export type WeeklyConfigPolicy = "uniform" | "recency" | "similarity";

/** Inclusive calendar-date range, "YYYY-MM-DD". */
export interface DateRange {
  start: string;
  end: string;
}

export interface UniverseMember {
  /** Stable asset ID (survives ticker changes). */
  asset_id: string;
  symbol: string;
}

export interface SelectedConfig {
  /** 0-B config_id of (grid_version, subset, params): 16 hex chars. */
  config_id: string;
  grid_version: string;
  /** Active components, sorted and unique, e.g. ["adx", "breakout"]. */
  subset: string[];
  /** Flat "component.param" -> value for every active component. */
  params: Record<string, number>;
}

export interface NoDeployment {
  reason: string;
}

export interface AcceptanceCheck {
  name: string;
  passed: boolean;
  value: number | null;
  threshold: number | null;
}

export interface AcceptanceResults {
  passed: boolean;
  checks: AcceptanceCheck[];
}

export interface Evaluations {
  logical: number;
  actual: number;
}

export interface ExitSettings {
  initial_stop_atr: number;
  trail_activation_atr: number;
  trail_distance_atr: number;
  max_hold_minutes: number;
  session_exit_minutes_before_close: number;
}

export interface FillSettings {
  kind: string;
  limit_markup: number;
}

export interface AccountSettings {
  starting_cash: number;
  max_positions: number;
  per_stock_pct: number;
  risk_pct: number;
  total_exposure_cap: number;
  liquidity_cap_pct: number;
  liquidity_lookback: number;
  liquidity_min_obs: number;
  daily_halt_pct: number;
  cost_bps: number;
  ranking: string;
  entry_score_threshold: number | null;
  size_multiplier: number | null;
  search_replay_reference_equity: number | null;
  exit: ExitSettings;
  fill: FillSettings;
}

export interface RuntimeStats {
  seconds: number;
  peak_memory_mb: number;
}

/** The weekly artifact. Exactly one of `selected` and `no_deployment` is non-null. */
export interface WeeklyConfig {
  schema_version: typeof WEEKLY_CONFIG_SCHEMA_VERSION;
  run_id: string;
  code_commit: string;
  data_version: string;
  protocol_hash: string | null;
  policy: WeeklyConfigPolicy;
  /** Timezone-aware ISO date-time. */
  decision_cutoff: string;
  search_range: DateRange;
  validation_range: DateRange;
  /** Activation week: first and last session date the config trades. */
  activation: DateRange;
  universe: UniverseMember[];
  selected: SelectedConfig | null;
  no_deployment: NoDeployment | null;
  acceptance: AcceptanceResults;
  ess: number;
  evaluations: Evaluations;
  seeds: number[];
  account: AccountSettings;
  runtime: RuntimeStats;
}
