/**
 * utils/time.ts
 *
 * Time and timestamp utility helpers used across the backend.
 * Centralizes time handling to simplify switching between wall-clock
 * time (live mode) and simulated time (backtest/replay mode).
 *
 * Inputs:  Date objects, ISO strings, Unix timestamps.
 * Outputs: Converted or formatted time values.
 */

import type { EpochMs, ISOTimestamp } from "../types/common";

// ------------------------------------------------------------------
// Clock override — replay / backtest determinism
// ------------------------------------------------------------------

/**
 * Module-level clock override. When set, nowMs() and nowIso() return
 * values from this function instead of the wall clock. The BacktestEngine
 * sets this to () => simulatedNow before each bar batch and clears it
 * (null) in a finally block when the run completes or throws.
 *
 * Node.js is single-threaded so this is safe for a single simulated run
 * inside a process that is doing nothing else. It is NOT safe in a process
 * that is also trading: every nowMs() caller in the live path — quote
 * timestamps, risk cooldowns, rolling-window eviction — would silently read
 * simulated time. lockClockForLive() below turns that rule into an assertion.
 */
let _clockOverride: (() => EpochMs) | null = null;

/**
 * Set to the execution mode ("paper" | "real") once a trading runtime has
 * started in this process. While set, installing a simulated clock throws.
 */
let _liveClockLock: string | null = null;

/**
 * Marks this process as running a live or paper trading engine, after which
 * any attempt to install a simulated clock throws instead of silently
 * corrupting live timestamps. Called by bootstrapRuntime once the
 * orchestrator is started. Idempotent.
 *
 * @param mode - Execution mode of the runtime ("paper" | "real")
 */
export function lockClockForLive(mode: string): void {
  _liveClockLock = mode;
}

/**
 * Releases the live-clock lock. Exists for test teardown only — production
 * code never unlocks, because a process that has traded stays a trading
 * process for its lifetime.
 */
export function unlockClockForLive(): void {
  _liveClockLock = null;
}

/** True when a live/paper trading runtime has claimed this process's clock. */
export function isClockLockedForLive(): boolean {
  return _liveClockLock !== null;
}

/**
 * Injects a simulated clock for backtest mode. Pass null to restore
 * wall-clock behavior.
 *
 * Throws when this process is running a live or paper trading engine —
 * simulated time must never leak into a path that is placing real orders.
 * Clearing the override (null) is always permitted so that cleanup paths,
 * including `finally` blocks, can never deadlock.
 *
 * @param fn - Function returning the current simulated time in Unix ms, or null
 * @throws Error when installing a clock in a live/paper process
 */
export function setClockOverride(fn: (() => EpochMs) | null): void {
  if (fn !== null && _liveClockLock !== null) {
    throw new Error(
      `Refusing to install a simulated clock: this process is running a ` +
        `'${_liveClockLock}' trading engine. Simulated time would corrupt live ` +
        `quote timestamps, risk cooldowns, and rolling-window eviction. Run ` +
        `backtests in the API-only process (npm run dev:api) or via ` +
        `npm run dev:backtest.`,
    );
  }
  _clockOverride = fn;
}

/**
 * Returns the current time in milliseconds (Unix epoch).
 * Returns simulated time when a clock override is active (replay/backtest mode),
 * otherwise returns the real wall-clock time via Date.now().
 * @returns Current time as EpochMs
 */
export function nowMs(): EpochMs {
  return _clockOverride ? _clockOverride() : Date.now();
}

/**
 * Converts an ISO 8601 timestamp string to Unix milliseconds.
 * @param iso - ISO 8601 string (e.g. "2024-01-15T09:30:00.000Z")
 * @returns Unix timestamp in milliseconds
 */
export function isoToMs(iso: ISOTimestamp): EpochMs {
  return new Date(iso).getTime();
}

/**
 * Nanoseconds since the epoch for an RFC 3339 timestamp such as Alpaca's
 * "2026-10-07T13:31:00.123456789Z". Use it to order ticks: Date.parse drops
 * everything past the millisecond, and the strings themselves do not sort,
 * since trailing fraction digits may be trimmed ("...:00Z" vs "...:00.1Z").
 * @param t - RFC 3339 timestamp
 * @returns Nanoseconds since the Unix epoch
 */
export function rfc3339ToNanos(t: ISOTimestamp): bigint {
  const match = /^(.+T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(t);
  if (!match) return BigInt(Date.parse(t)) * 1_000_000n;
  const wholeSecondsMs = Date.parse(match[1] + match[3]);
  return BigInt(wholeSecondsMs) * 1_000_000n + BigInt((match[2] ?? "").padEnd(9, "0"));
}

/**
 * Converts a Unix millisecond timestamp to an ISO 8601 string.
 * @param ms - Unix timestamp in milliseconds
 * @returns ISO 8601 string
 */
export function msToIso(ms: EpochMs): ISOTimestamp {
  return new Date(ms).toISOString();
}

/**
 * Returns the current time as an ISO 8601 string.
 * Respects the active clock override so simulated time propagates correctly
 * through any code path that formats timestamps as ISO strings.
 * @returns ISO 8601 string representing now
 */
export function nowIso(): ISOTimestamp {
  return new Date(nowMs()).toISOString();
}

/**
 * Checks whether a timestamp is older than a given threshold.
 * @param ts - Timestamp to check (Unix ms)
 * @param thresholdMs - Maximum age in milliseconds
 * @param nowOverride - Optional override for "now" (used in tests / replay)
 * @returns true if the timestamp is stale
 */
export function isStale(ts: EpochMs, thresholdMs: number, nowOverride?: EpochMs): boolean {
  const now = nowOverride ?? nowMs();
  return now - ts > thresholdMs;
}

/**
 * Formats a Unix ms timestamp as a human-readable local string.
 * Suitable for log messages, not for data serialization.
 * @param ms - Unix timestamp in milliseconds
 * @returns Human-readable date-time string
 */
export function formatTs(ms: EpochMs): string {
  return new Date(ms).toLocaleString();
}

/** Unit lengths for the short forms live bars use ("1m") and Alpaca's REST names ("1Min"). */
const TIMEFRAME_UNIT_MS = new Map<string, number>([
  ["s", 1_000],
  ["m", 60_000], ["Min", 60_000],
  ["h", 3_600_000], ["Hour", 3_600_000],
  ["d", 86_400_000], ["Day", 86_400_000],
]);

/**
 * Parses a timeframe string (e.g. "5m", "1h", "1d", "1Min", "1Hour") into milliseconds.
 * @param timeframe - Timeframe string
 * @returns Duration in milliseconds
 */
export function timeframeToMs(timeframe: string): number {
  const cached = TIMEFRAME_MS_CACHE.get(timeframe);
  if (cached !== undefined) return cached;
  const ms = parseTimeframeMs(timeframe);
  if (TIMEFRAME_MS_CACHE.size < 64) TIMEFRAME_MS_CACHE.set(timeframe, ms);
  return ms;
}

/** Parsed timeframes; a backtest asks for the same one on every bar. */
const TIMEFRAME_MS_CACHE = new Map<string, number>();

function parseTimeframeMs(timeframe: string): number {
  const match = /^(\d+)([A-Za-z]+)$/.exec(timeframe);
  const unit = match?.[2] ?? timeframe;
  const unitMs = TIMEFRAME_UNIT_MS.get(unit);
  if (!match || unitMs === undefined) {
    throw new Error(`Unknown timeframe unit: "${unit}" in "${timeframe}"`);
  }
  return Number(match[1]) * unitMs;
}

/**
 * When a bar's interval closed: the earliest moment its OHLCV could be known.
 * Bars are stamped with their interval's start, so the 10:00 minute bar is
 * only available at 10:01. Every bar in this system is a minute bar, so an
 * unrecognised timeframe is treated as one minute rather than failing a run.
 * @param bar - Any bar-shaped value
 * @returns Unix ms at which the bar completed
 */
export function barEndMs(bar: { ts: EpochMs; timeframe: string }): EpochMs {
  let durationMs = 60_000;
  try {
    durationMs = timeframeToMs(bar.timeframe);
  } catch {
    // keep the one-minute default
  }
  return bar.ts + durationMs;
}

/**
 * Returns the start of the current trading day in UTC as Unix ms.
 * Markets open at 09:30 ET = 13:30 UTC (non-DST) / 14:30 UTC (DST).
 * For simplicity this returns 00:00 UTC of the current date.
 * @returns Start of today in UTC (Unix ms)
 */
export function startOfDayUtcMs(): EpochMs {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now.getTime();
}
