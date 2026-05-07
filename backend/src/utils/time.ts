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
 * values from this function instead of the wall clock. The ReplayEngine
 * sets this to () => session.simulatedNow before each event emission
 * and clears it (null) when the session stops or completes.
 *
 * Node.js is single-threaded so this is safe for a single replay session.
 * Never set this in live or paper mode.
 */
let _clockOverride: (() => EpochMs) | null = null;

/**
 * Injects a simulated clock for replay/backtest modes.
 * Pass null to restore wall-clock behavior.
 * @param fn - Function returning the current simulated time in Unix ms, or null
 */
export function setClockOverride(fn: (() => EpochMs) | null): void {
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

/**
 * Parses a timeframe string (e.g. "5m", "1h", "1d") into milliseconds.
 * @param timeframe - Timeframe string
 * @returns Duration in milliseconds
 */
export function timeframeToMs(timeframe: string): number {
  const unit = timeframe.slice(-1);
  const value = parseInt(timeframe.slice(0, -1), 10);
  switch (unit) {
    case "s": return value * 1_000;
    case "m": return value * 60_000;
    case "h": return value * 3_600_000;
    case "d": return value * 86_400_000;
    default:
      throw new Error(`Unknown timeframe unit: "${unit}" in "${timeframe}"`);
  }
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
