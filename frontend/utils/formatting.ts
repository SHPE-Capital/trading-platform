/**
 * utils/formatting.ts
 *
 * Number and string formatting utilities for the frontend.
 * Centralizes display formatting to keep component code clean.
 */

/**
 * Formats a number as USD currency.
 * @param value - Numeric value
 * @param decimals - Decimal places (default 2)
 * @returns Formatted string like "$1,234.56"
 */
export function formatCurrency(value: number, decimals = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Formats a decimal fraction as a percentage string.
 * @param value - Decimal fraction (e.g. 0.0542 → "5.42%")
 * @param decimals - Decimal places (default 2)
 * @returns Formatted percentage string
 */
export function formatPercent(value: number, decimals = 2): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Formats a large number with K/M/B suffixes for compact display.
 * @param value - Numeric value
 * @returns Compact string like "1.2M"
 */
export function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/**
 * Formats a number with a configurable number of decimal places.
 * @param value - Numeric value
 * @param decimals - Decimal places
 * @returns Formatted number string
 */
export function formatNumber(value: number, decimals = 4): string {
  return value.toFixed(decimals);
}

/**
 * Returns a CSS color class name based on whether a value is positive or negative.
 * Used for PnL display coloring.
 * @param value - Numeric value
 * @returns Tailwind color class string
 */
export function pnlColorClass(value: number): string {
  if (value > 0) return "text-green-600 dark:text-green-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "text-zinc-500";
}
