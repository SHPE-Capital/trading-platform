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

/**
 * Returns the current wall-clock time in milliseconds (Unix epoch).
 * @returns Current time as EpochMs
 */
export function nowMs(): EpochMs {
  return Date.now();
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
 * @returns ISO 8601 string representing now
 */
export function nowIso(): ISOTimestamp {
  return new Date().toISOString();
}

/**
 * Checks whether a timestamp is older than a given threshold.
 * @param ts - Timestamp to check (Unix ms)
 * @param thresholdMs - Maximum age in milliseconds
 * @param nowOverride - Optional override for "now" (used in tests / replay)
 * @returns true if the timestamp is stale
 */
export function isStale(ts: EpochMs, thresholdMs: number, nowOverride?: EpochMs): boolean {
  const now = nowOverride ?? Date.now();
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
