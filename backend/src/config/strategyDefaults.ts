/**
 * config/strategyDefaults.ts
 *
 * Hardcoded strategy type definitions loaded at startup.
 * Each entry carries the algorithm version and a fully-populated default
 * config that the frontend uses to pre-fill new strategy forms.
 *
 * version tracks the strategy algorithm version, not per-config edit counts.
 * New configs inherit STRATEGY_DEFINITIONS[type].version at creation time.
 * Bump version here when the algorithm changes in a breaking way.
 */

import type { StrategyType } from "../types/strategy";
import { DEFAULT_PAIRS_CONFIG } from "../strategies/pairs/pairsConfig";

export interface StrategyDefinition {
  type: StrategyType;
  label: string;
  description: string;
  /** Algorithm version — written to strategies.version on INSERT */
  version: number;
  defaultConfig: Record<string, unknown>;
}

export const STRATEGY_DEFINITIONS: Record<string, StrategyDefinition> = {
  pairs_trading: {
    type: "pairs_trading",
    label: "Pairs Trading",
    description:
      "Statistical arbitrage between two correlated instruments using z-score mean reversion.",
    version: 1,
    defaultConfig: {
      ...DEFAULT_PAIRS_CONFIG,
      leg1Symbol: "SPY",
      leg2Symbol: "QQQ",
      symbols: ["SPY", "QQQ"],
      name: "Pairs: SPY/QQQ",
    },
  },
};
