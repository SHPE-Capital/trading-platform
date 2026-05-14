/**
 * core/backtest/dataValidation.ts
 *
 * Validates and reports on historical bar data prior to backtest execution.
 *
 * Checks performed (per bar, per symbol, and cross-bar):
 *   - Required fields present and numerically valid (OHLC finite positive,
 *     volume finite non-negative, ts present).
 *   - OHLC consistency: high ≥ max(open, close), low ≤ min(open, close),
 *     high ≥ low.
 *   - Symbol presence and matches the requested universe.
 *   - Per-symbol timestamp ordering (after caller-side sort) and duplicates.
 *   - Gap detection: when timeframe-derived expected spacing is known, flag
 *     gaps significantly larger than expected (informational only — markets
 *     close and weekends are normal).
 *
 * Outputs:
 *   - errors: fatal issues. Caller should refuse to run the backtest.
 *   - warnings: informational issues. Caller should surface them but proceed.
 *   - dropped: bars removed from the input due to invalidity (caller may use
 *     the filtered list to continue running).
 *   - metadata: counts useful for reporting (gaps, duplicates dropped, etc).
 *
 * NOTE on corporate actions: this module does NOT detect splits or dividends.
 * Adjustments must be requested upstream (BacktestLoader uses adjustment="raw"
 * today). If the loader is later updated to fetch adjusted data, callers
 * should set `metadata.adjustment` accordingly so the report reflects it.
 */

import type { Bar } from "../../types/market";
import type { Symbol } from "../../types/common";

export type ValidationSeverity = "error" | "warning";

/** A single issue identified during validation. */
export interface ValidationIssue {
  severity: ValidationSeverity;
  symbol?: Symbol;
  ts?: number;
  message: string;
  /** Additional structured context (e.g. expected vs actual). */
  context?: Record<string, unknown>;
}

/** Summary metadata reported alongside issues. */
export interface ValidationMetadata {
  totalBarsInput: number;
  totalBarsAccepted: number;
  duplicateBarsDropped: number;
  invalidBarsDropped: number;
  /** Per-symbol gap counts (gaps larger than 2x the median spacing). */
  largeGapsBySymbol: Record<string, number>;
  /** Per-symbol smallest gap. Useful for inferring timeframe. */
  medianSpacingMsBySymbol: Record<string, number>;
  /** Adjustment policy reported in the result for downstream visibility. */
  adjustment?: "raw" | "split" | "all" | "unknown";
  /** Generic warning about adjustment being raw — surfaced for the result. */
  rawAdjustmentWarning?: string;
}

/** Final validation result returned by `validateBars`. */
export interface ValidationResult {
  bars: Bar[];
  issues: ValidationIssue[];
  metadata: ValidationMetadata;
  /** True iff there are no `error` severity issues. */
  ok: boolean;
}

/**
 * Validates and (optionally) filters a chronologically ordered list of bars.
 * The caller is expected to have sorted bars by (ts asc, symbol asc) before
 * invoking. Bars are validated per-symbol for ordering and dedup.
 *
 * @param bars - Bars to validate (may be empty).
 * @param expectedSymbols - Symbols requested by the backtest config; bars for
 *                          unrequested symbols are flagged as warnings.
 * @param adjustment - Optional adjustment policy used by the loader (for metadata).
 */
export function validateBars(
  bars: Bar[],
  expectedSymbols: Symbol[],
  adjustment: ValidationMetadata["adjustment"] = "raw",
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const accepted: Bar[] = [];

  let duplicateBarsDropped = 0;
  let invalidBarsDropped = 0;

  const lastTsBySymbol = new Map<Symbol, number>();
  const spacingsBySymbol = new Map<Symbol, number[]>();
  const requestedSet = new Set(expectedSymbols);

  for (const bar of bars) {
    if (!bar.symbol || typeof bar.symbol !== "string") {
      issues.push({ severity: "error", message: "Bar missing symbol", ts: bar.ts });
      invalidBarsDropped++;
      continue;
    }
    if (!requestedSet.has(bar.symbol)) {
      issues.push({
        severity: "warning",
        symbol: bar.symbol,
        ts: bar.ts,
        message: "Bar for symbol not in requested universe",
      });
      // We keep these bars (don't drop) — the orchestrator will simply ignore
      // them unless a strategy listens for them. But mark as warning.
    }

    if (
      !Number.isFinite(bar.open) ||
      !Number.isFinite(bar.high) ||
      !Number.isFinite(bar.low) ||
      !Number.isFinite(bar.close)
    ) {
      issues.push({
        severity: "error",
        symbol: bar.symbol,
        ts: bar.ts,
        message: "Bar has non-finite OHLC values",
        context: { open: bar.open, high: bar.high, low: bar.low, close: bar.close },
      });
      invalidBarsDropped++;
      continue;
    }
    if (bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0) {
      issues.push({
        severity: "error",
        symbol: bar.symbol,
        ts: bar.ts,
        message: "Bar has non-positive OHLC value",
        context: { open: bar.open, high: bar.high, low: bar.low, close: bar.close },
      });
      invalidBarsDropped++;
      continue;
    }
    if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.high < bar.low) {
      issues.push({
        severity: "error",
        symbol: bar.symbol,
        ts: bar.ts,
        message: "Bar OHLC inconsistent (high<max(open,close) or low>min(open,close) or high<low)",
        context: { open: bar.open, high: bar.high, low: bar.low, close: bar.close },
      });
      invalidBarsDropped++;
      continue;
    }
    if (!Number.isFinite(bar.volume) || bar.volume < 0) {
      issues.push({
        severity: "error",
        symbol: bar.symbol,
        ts: bar.ts,
        message: "Bar has invalid (non-finite or negative) volume",
        context: { volume: bar.volume },
      });
      invalidBarsDropped++;
      continue;
    }
    if (!Number.isFinite(bar.ts)) {
      issues.push({
        severity: "error",
        symbol: bar.symbol,
        message: "Bar has invalid timestamp",
      });
      invalidBarsDropped++;
      continue;
    }

    const prev = lastTsBySymbol.get(bar.symbol);
    if (prev !== undefined) {
      if (bar.ts < prev) {
        issues.push({
          severity: "error",
          symbol: bar.symbol,
          ts: bar.ts,
          message: "Bars out of order for symbol",
          context: { previous: prev, current: bar.ts },
        });
        invalidBarsDropped++;
        continue;
      }
      if (bar.ts === prev) {
        issues.push({
          severity: "warning",
          symbol: bar.symbol,
          ts: bar.ts,
          message: "Duplicate bar timestamp for symbol — dropped",
        });
        duplicateBarsDropped++;
        continue;
      }
      const spacings = spacingsBySymbol.get(bar.symbol) ?? [];
      spacings.push(bar.ts - prev);
      spacingsBySymbol.set(bar.symbol, spacings);
    }

    lastTsBySymbol.set(bar.symbol, bar.ts);
    accepted.push(bar);
  }

  // Gap detection — informational. Use median spacing as expected cadence; any
  // gap > 2x median is flagged. Markets close, so plenty of gaps are normal.
  const largeGapsBySymbol: Record<string, number> = {};
  const medianSpacingMsBySymbol: Record<string, number> = {};
  for (const [symbol, spacings] of spacingsBySymbol) {
    if (spacings.length === 0) continue;
    const sorted = [...spacings].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    medianSpacingMsBySymbol[symbol] = median;
    const threshold = Math.max(median * 2, median + 60_000);
    let gapCount = 0;
    for (const s of spacings) {
      if (s > threshold) gapCount++;
    }
    if (gapCount > 0) {
      largeGapsBySymbol[symbol] = gapCount;
      issues.push({
        severity: "warning",
        symbol,
        message: `Detected ${gapCount} bar gaps larger than 2x median spacing`,
        context: { medianMs: median, count: gapCount },
      });
    }
  }

  // Per-symbol expected presence check
  for (const sym of expectedSymbols) {
    if (!lastTsBySymbol.has(sym)) {
      issues.push({
        severity: "warning",
        symbol: sym,
        message: "Requested symbol has no bars in the period",
      });
    }
  }

  const rawAdjustmentWarning =
    adjustment === "raw"
      ? "Bars use raw (unadjusted) prices: corporate actions (splits/dividends) are not applied. Long-horizon backtests across action dates may show artificial jumps."
      : undefined;
  if (rawAdjustmentWarning) {
    issues.push({ severity: "warning", message: rawAdjustmentWarning });
  }

  const metadata: ValidationMetadata = {
    totalBarsInput: bars.length,
    totalBarsAccepted: accepted.length,
    duplicateBarsDropped,
    invalidBarsDropped,
    largeGapsBySymbol,
    medianSpacingMsBySymbol,
    adjustment,
    rawAdjustmentWarning,
  };

  return {
    bars: accepted,
    issues,
    metadata,
    ok: issues.every((i) => i.severity !== "error"),
  };
}
