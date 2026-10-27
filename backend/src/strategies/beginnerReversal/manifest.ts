/**
 * strategies/beginnerReversal/manifest.ts
 *
 * UI registration for the beginner reversal reference. Released for testing
 * through the strategy and backtest forms.
 */

import { asProblem, type StrategyManifest } from "../../config/strategyManifest";
import {
  BeginnerReversalStrategy,
  DEFAULT_BEGINNER_REVERSAL_CONFIG,
  DEFAULT_BEGINNER_REVERSAL_SYMBOLS,
  createBeginnerReversalConfig,
  validateBeginnerReversalConfig,
  type BeginnerReversalConfig,
} from "./beginnerReversalStrategy";

export const beginnerReversalManifest: StrategyManifest = {
  type: "beginner_reversal",
  status: "ready",
  label: "Beginner Reversal (course)",
  description:
    "Course example: sells a symbol after its 1-minute bar closes up and buys after it closes down, " +
    "one fixed share size per bar with a per-symbol position cap.",
  version: BeginnerReversalStrategy.VERSION,
  defaultConfig: {
    ...DEFAULT_BEGINNER_REVERSAL_CONFIG,
    symbols: [...DEFAULT_BEGINNER_REVERSAL_SYMBOLS],
    name: "Beginner Reversal: SPY + AAPL",
  },
  // Saved configs may omit fields; createBeginnerReversalConfig fills them from the defaults.
  create: (config) =>
    new BeginnerReversalStrategy(createBeginnerReversalConfig(config as Partial<BeginnerReversalConfig>)),
  validate: (config) =>
    asProblem(() => validateBeginnerReversalConfig(createBeginnerReversalConfig(config as Partial<BeginnerReversalConfig>))),
  params: [
    { key: "symbols", label: "Symbols", kind: "symbols", hint: "Comma-separated, e.g. SPY, AAPL" },
    { key: "qtyPerTrade", label: "Shares per trade", kind: "number", min: 1, step: 1 },
    {
      key: "maxPositionQty",
      label: "Max position (shares)",
      kind: "number",
      min: 1,
      step: 1,
      hint: "Orders that would exceed this per symbol are skipped",
    },
  ],
};
