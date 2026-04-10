/**
 * utils/dates.ts
 *
 * Date and timestamp formatting utilities for the frontend.
 */

/**
 * Formats a Unix millisecond timestamp for display.
 * @param ts - Unix timestamp in milliseconds
 * @returns Formatted date-time string
 */
export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Formats an ISO 8601 timestamp string for display.
 * @param iso - ISO 8601 string
 * @returns Formatted date-time string
 */
export function formatIsoTimestamp(iso: string): string {
  return formatTimestamp(new Date(iso).getTime());
}

/**
 * Returns a human-readable duration string from milliseconds.
 * @param ms - Duration in milliseconds
 * @returns String like "2h 15m" or "45s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.floor(ms / 1_000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1_000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

/**
 * Returns today's date as a YYYY-MM-DD string for date input defaults.
 * @returns Today's date string
 */
export function todayString(): string {
  return new Date().toISOString().split("T")[0] ?? "";
}

/**
 * Returns a date N days ago as a YYYY-MM-DD string.
 * @param daysAgo - Number of days back
 * @returns Date string N days ago
 */
export function daysAgoString(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0] ?? "";
}
