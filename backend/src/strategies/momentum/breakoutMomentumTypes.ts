/**
 * strategies/momentum/breakoutMomentumTypes.ts
 *
 * Types for the breakout momentum strategy: the strategy config, the resolved
 * per-week parameters, the per-bar decision record, and the narrow entry
 * intent / exit plan outputs that sizing (P1-5), the allocator (P1-4), the
 * quote-gated entry (P2-2) and the exit state machine (P2-3) build on. Those
 * tasks live on separate branches, so nothing here imports them.
 *
 * Inputs:  none (types only).
 * Outputs: the types below.
 */

import type { BaseStrategyConfig } from "../../types/strategy";
import type { EntriesDisabledReason } from "./weeklyConfigLoader";

/**
 * Signal constants that research keeps in its protocol config (0-G) rather than
 * in the weekly artifact. They live in the strategy config, never in code, so a
 * change is a config edit. Defaults mirror the protocol defaults.
 */
export interface BreakoutSignalSettings {
  /** ATR length (breakout/EMA/VWAP are normalised by it). Protocol: 14. */
  atrLength: number;
  /** Recursive indicators need warmupMultiple x their length of history (B4). Protocol: 5. */
  warmupMultiple: number;
  /** EMA trend compares the slow EMA with its value this many bars earlier. Protocol: 5. */
  emaSlowLookback: number;
  /** Prior sessions in the relative-volume median (B3). Protocol: 20. */
  rvolHistorySessions: number;
  /** Minimum usable prior windows for relative volume (B3). Protocol: 15. */
  rvolMinObservations: number;
  /** Relative tolerance of the signal comparisons (research FLOAT_TOL). */
  floatTol: number;
}

/** Regular-session clock, in minutes after local midnight (America/New_York). */
export interface SessionClockSettings {
  /** First bar of the session. 570 = 09:30. */
  openMinute: number;
  /** Close. 960 = 16:00. Early-close days are not modelled. */
  closeMinute: number;
}

export interface BreakoutMomentumConfig extends BaseStrategyConfig {
  /**
   * The raw weekly artifact (0-A JSON), or null when none is available yet.
   * Fed to the WeeklyConfigManager at construction; replace later with
   * `submitArtifact()`. Absent or invalid means no new entries.
   */
  weeklyConfigArtifact: unknown;
  signals: BreakoutSignalSettings;
  session: SessionClockSettings;
  /** Bars of history kept per symbol to rebuild indicators when the week's parameters change. */
  historyBars: number;
}

/** Selected parameters of the active week, resolved from `selected.params`. */
export interface BreakoutParams {
  breakout: { n: number; b: number };
  adx: { period: number; q: number } | null;
  ema: { fast: number; slow: number; d: number } | null;
  rvol: { w: number; v: number } | null;
  vwap: { e: number } | null;
}

export type ConfirmationName = "adx" | "ema" | "rvol" | "vwap";
export type ComponentName = "breakout" | ConfirmationName;

/** Indicator values at one bar; NaN where not yet defined. Recorded with every candidate. */
export interface IndicatorSnapshot {
  atr: number;
  /** Max of the n preceding highs (current bar excluded). */
  precedingHigh: number;
  /** precedingHigh + b * atr. */
  breakoutThreshold: number;
  adx: number;
  plusDi: number;
  minusDi: number;
  emaFast: number;
  emaSlow: number;
  /** Slow EMA `emaSlowLookback` bars earlier. */
  emaSlowPrev: number;
  rvol: number;
  vwap: number;
}

export interface ComponentResult {
  /** Warm-up and finiteness rules (B4) are met. */
  ready: boolean;
  /** The component's condition holds (false when not ready). */
  pass: boolean;
}

export type BarSkipReason =
  | EntriesDisabledReason
  | "params_unsupported"
  | "symbol_not_in_universe"
  | "outside_session"
  | "bad_bar"
  | "out_of_order"
  | "indicators_not_ready"
  | "no_signal"
  | "entry_window_closed"
  | "already_entered_today"
  | "entry_pending"
  | "holding";

/** What the strategy concluded for one completed bar of one symbol. */
export interface BarDecision {
  symbol: string;
  assetId: string | null;
  barTs: number;
  /** Local session date "YYYY-MM-DD" (America/New_York). */
  sessionDate: string;
  runId: string | null;
  configId: string | null;
  /** The weekly artifact lets this symbol open a position now. */
  entriesAllowed: boolean;
  components: Partial<Record<ComponentName, ComponentResult>>;
  indicators: IndicatorSnapshot | null;
  /** Breakout AND every selected confirmation, all ready (before the entry rules below). */
  signal: boolean;
  /** Present when the bar became an entry candidate. */
  intent: EntryIntent | null;
  /** Why no intent was produced; null when `intent` is set. */
  skipReason: BarSkipReason | null;
}

/** An entry the strategy wants. Sizing and allocation are downstream. */
export interface EntryIntent {
  symbol: string;
  assetId: string;
  runId: string;
  configId: string;
  /** Decision bar (period start, Unix ms) and its session. */
  barTs: number;
  sessionDate: string;
  /** Close of the decision bar: the reference price for limit, stop and size. */
  referenceClose: number;
  /** close * (1 + fill.limit_markup) when the artifact's fill kind is limit_markup, else null. */
  limitPrice: number | null;
  atr: number;
  indicators: IndicatorSnapshot;
  /** Exit rules in force for this entry (artifact exit settings). */
  exitPlan: ExitPlan;
}

/**
 * Exit rules for a position, straight from the artifact's `account.exit`. Prices
 * depend on the fill, so they are expressed in ATR multiples of the entry ATR;
 * the exit state machine (P2-3) turns them into levels once filled.
 */
export interface ExitPlan {
  entryAtr: number;
  initialStopAtr: number;
  trailActivationAtr: number;
  trailDistanceAtr: number;
  maxHoldMinutes: number;
  sessionExitMinutesBeforeClose: number;
  /** Minute of day (local) at which positions are closed: close - sessionExitMinutesBeforeClose. */
  sessionExitMinuteOfDay: number;
}

/**
 * Turns an intent into a share quantity. P1-5 (funded-account sizer) replaces
 * the default; a quantity of 0 or less means no signal.
 */
export type EntrySizer = (intent: EntryIntent) => number;
