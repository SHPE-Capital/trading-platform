/**
 * strategies/momentum/breakoutMomentumConfig.ts
 *
 * Defaults, factory and validation for the breakout momentum strategy, and the
 * resolution of a weekly artifact's `selected.params` into typed parameters.
 * Only the platform plumbing (bar history depth, signal constants research keeps
 * in its protocol config, the session clock) is configured here; every strategy
 * tunable (n, b, ADX, EMA, RVOL, VWAP, exits, fill, sizing inputs) comes from
 * the artifact.
 *
 * Inputs:  Partial config overrides; a SelectedConfig.
 * Outputs: a complete validated config; BreakoutParams or a refusal reason.
 */

import { newId } from "../../utils/ids";
import type { BreakoutMomentumConfig, BreakoutParams } from "./breakoutMomentumTypes";
import type { SelectedConfig } from "./weeklyConfig";

const DEFAULT_SESSION = { openMinute: 9 * 60 + 30, closeMinute: 16 * 60 };
const DEFAULT_SIGNALS = {
  atrLength: 14,
  warmupMultiple: 5,
  emaSlowLookback: 5,
  rvolHistorySessions: 20,
  rvolMinObservations: 15,
  floatTol: 1e-6,
};

export const DEFAULT_BREAKOUT_MOMENTUM_CONFIG: Omit<BreakoutMomentumConfig, "id" | "symbols"> = {
  name: "Breakout Momentum",
  type: "momentum",
  rollingWindowMs: 60_000,
  maxPositionSizeUsd: 10_000,
  cooldownMs: 0,
  enabled: true,
  weeklyConfigArtifact: null,
  signals: DEFAULT_SIGNALS,
  session: DEFAULT_SESSION,
  // One extra session for the current day on top of the relative-volume history.
  historyBars: (DEFAULT_SIGNALS.rvolHistorySessions + 1) * (DEFAULT_SESSION.closeMinute - DEFAULT_SESSION.openMinute),
};

/** Merges overrides over the defaults; nested `signals` and `session` merge field by field. */
export function createBreakoutMomentumConfig(
  overrides: Partial<BreakoutMomentumConfig> = {},
): BreakoutMomentumConfig {
  return {
    ...DEFAULT_BREAKOUT_MOMENTUM_CONFIG,
    id: newId(),
    symbols: [],
    ...overrides,
    signals: { ...DEFAULT_SIGNALS, ...overrides.signals },
    session: { ...DEFAULT_SESSION, ...overrides.session },
  };
}

const isPosInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 1;

/** Throws on a config the strategy cannot run safely. */
export function validateBreakoutMomentumConfig(config: BreakoutMomentumConfig): void {
  const fail = (m: string): never => { throw new Error(`momentum: ${m}`); };
  const s = config.signals;
  for (const k of ["atrLength", "warmupMultiple", "emaSlowLookback", "rvolHistorySessions", "rvolMinObservations"] as const) {
    if (!isPosInt(s[k])) fail(`signals.${k} must be a positive whole number (got ${s[k]})`);
  }
  if (s.rvolMinObservations > s.rvolHistorySessions) fail("signals.rvolMinObservations cannot exceed rvolHistorySessions");
  if (!(s.floatTol >= 0 && s.floatTol < 1)) fail(`signals.floatTol must be in [0, 1) (got ${s.floatTol})`);
  const { openMinute, closeMinute } = config.session;
  if (!Number.isInteger(openMinute) || !Number.isInteger(closeMinute) || openMinute < 0 || closeMinute > 1440 || closeMinute <= openMinute) {
    fail(`session must satisfy 0 <= openMinute < closeMinute <= 1440 (got ${openMinute}, ${closeMinute})`);
  }
  if (!isPosInt(config.historyBars)) fail(`historyBars must be a positive whole number (got ${config.historyBars})`);
  if (new Set(config.symbols).size !== config.symbols.length) fail("symbols must be unique");
}

const KNOWN_COMPONENTS = ["breakout", "adx", "ema", "rvol", "vwap"] as const;
const PARAM_KEYS: Record<(typeof KNOWN_COMPONENTS)[number], readonly string[]> = {
  breakout: ["n", "b"],
  adx: ["period", "q"],
  ema: ["fast", "slow", "d"],
  rvol: ["w", "v"],
  vwap: ["e"],
};

export type ResolveParamsResult = { ok: true; params: BreakoutParams } | { ok: false; reason: string };

/**
 * Reads the artifact's flat "component.param" map into typed parameters.
 * Refuses (never guesses) when the subset lacks breakout, names an unknown
 * component, misses or adds a key, or holds a value the indicators cannot use.
 */
export function resolveBreakoutParams(selected: SelectedConfig): ResolveParamsResult {
  const refuse = (reason: string): ResolveParamsResult => ({ ok: false, reason });
  const subset = new Set(selected.subset);
  if (!subset.has("breakout")) return refuse("subset has no breakout component");
  for (const c of subset) {
    if (!(KNOWN_COMPONENTS as readonly string[]).includes(c)) return refuse(`unknown component "${c}"`);
  }
  const expected = new Set<string>();
  for (const c of KNOWN_COMPONENTS) if (subset.has(c)) for (const p of PARAM_KEYS[c]) expected.add(`${c}.${p}`);
  const got = Object.keys(selected.params);
  if (got.length !== expected.size || got.some((k) => !expected.has(k))) {
    return refuse(`params must be exactly ${[...expected].sort().join(", ")}`);
  }
  const p = selected.params;
  const intOk = (k: string) => isPosInt(p[k]);
  const nonNeg = (k: string) => Number.isFinite(p[k]) && p[k] >= 0;

  if (!intOk("breakout.n") || !nonNeg("breakout.b")) return refuse("breakout.n must be a positive integer and breakout.b >= 0");
  const params: BreakoutParams = { breakout: { n: p["breakout.n"], b: p["breakout.b"] }, adx: null, ema: null, rvol: null, vwap: null };
  if (subset.has("adx")) {
    if (!intOk("adx.period") || !nonNeg("adx.q")) return refuse("adx.period must be a positive integer and adx.q >= 0");
    params.adx = { period: p["adx.period"], q: p["adx.q"] };
  }
  if (subset.has("ema")) {
    if (!intOk("ema.fast") || !intOk("ema.slow") || !nonNeg("ema.d")) return refuse("ema.fast and ema.slow must be positive integers and ema.d >= 0");
    if (p["ema.slow"] <= p["ema.fast"]) return refuse("ema.slow must exceed ema.fast");
    params.ema = { fast: p["ema.fast"], slow: p["ema.slow"], d: p["ema.d"] };
  }
  if (subset.has("rvol")) {
    if (!intOk("rvol.w") || !Number.isFinite(p["rvol.v"]) || p["rvol.v"] <= 0) return refuse("rvol.w must be a positive integer and rvol.v > 0");
    params.rvol = { w: p["rvol.w"], v: p["rvol.v"] };
  }
  if (subset.has("vwap")) {
    if (!nonNeg("vwap.e")) return refuse("vwap.e must be >= 0");
    params.vwap = { e: p["vwap.e"] };
  }
  return { ok: true, params };
}
