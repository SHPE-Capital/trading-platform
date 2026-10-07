/**
 * strategies/minuteReversal/minuteReversalConfig.ts
 *
 * Defaults, factory, and validation for the minute-reversal test strategy.
 *
 * Inputs:  Partial MinuteReversalConfig overrides from caller.
 * Outputs: A complete, validated MinuteReversalConfig.
 */

import { newId } from "../../utils/ids";
import type { MinuteReversalConfig } from "./minuteReversalTypes";
import type { ExecutionAlgoType } from "../../types/common";

/** The large-cap universe the strategy was written to exercise. */
export const DEFAULT_MINUTE_REVERSAL_SYMBOLS = [
  "NVDA", "AAPL", "MSFT", "MU", "AMD", "AMZN", "META", "GOOGL", "SPCX", "TSLA",
];

/**
 * Conservative defaults for the shared paper book: one share per order and at
 * most one share held either way per symbol, so the whole universe stays near
 * the sandbox capital cap even at its worst.
 */
export const DEFAULT_MINUTE_REVERSAL_CONFIG: Omit<MinuteReversalConfig, "id" | "symbols"> = {
  name: "Minute Reversal",
  type: "minute_reversal",
  rollingWindowMs: 60_000,
  maxPositionSizeUsd: 10_000,
  cooldownMs: 0,
  enabled: true,

  qtyPerTrade: 1,
  maxPositionQty: 1,
  maxBarGapMs: 3 * 60_000,
  regularHoursOnly: true,

  executionAlgo: "market" as ExecutionAlgoType,
};

/**
 * Creates a complete MinuteReversalConfig by merging defaults with overrides.
 * A new ID is assigned unless one is provided.
 */
export function createMinuteReversalConfig(
  overrides: Partial<MinuteReversalConfig> = {},
): MinuteReversalConfig {
  return {
    ...DEFAULT_MINUTE_REVERSAL_CONFIG,
    id: newId(),
    symbols: [...DEFAULT_MINUTE_REVERSAL_SYMBOLS],
    ...overrides,
  };
}

/**
 * Throws on a config the strategy cannot trade safely. Called by the strategy
 * constructor, so a bad saved config fails at start rather than mid-session.
 */
export function validateMinuteReversalConfig(config: MinuteReversalConfig): void {
  const symbols = config.symbols ?? [];
  if (symbols.length === 0) throw new Error("minute_reversal: symbols must not be empty");
  if (new Set(symbols).size !== symbols.length) throw new Error("minute_reversal: symbols must be unique");
  if (!Number.isInteger(config.qtyPerTrade) || config.qtyPerTrade <= 0) {
    throw new Error(`minute_reversal: qtyPerTrade must be a positive whole number (got ${config.qtyPerTrade})`);
  }
  if (!Number.isInteger(config.maxPositionQty) || config.maxPositionQty < config.qtyPerTrade) {
    throw new Error(
      `minute_reversal: maxPositionQty must be a whole number >= qtyPerTrade (got ${config.maxPositionQty})`,
    );
  }
  if (!(config.maxBarGapMs >= 60_000)) {
    throw new Error(`minute_reversal: maxBarGapMs must be at least one minute (got ${config.maxBarGapMs})`);
  }
}
