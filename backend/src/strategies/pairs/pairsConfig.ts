/**
 * strategies/pairs/pairsConfig.ts
 *
 * Default configuration and factory helpers for the pairs trading strategy.
 * Provides sensible starting defaults that can be overridden via the frontend
 * strategy configuration UI or programmatically.
 *
 * Inputs:  Partial PairsStrategyConfig overrides from caller.
 * Outputs: A complete, valid PairsStrategyConfig ready for instantiation.
 */

import { newId } from "../../utils/ids";
import type { PairsStrategyConfig } from "./pairsTypes";
import type { Symbol } from "../../types/common";

/**
 * Default pairs strategy configuration values.
 * These represent conservative initial settings suitable for paper trading.
 */
export const DEFAULT_PAIRS_CONFIG: Omit<
  PairsStrategyConfig,
  "id" | "leg1Symbol" | "leg2Symbol" | "symbols"
> = {
  name: "Pairs Trading",
  type: "pairs_trading",
  rollingWindowMs: 3_600_000,   // 1 hour rolling window for statistics
  maxPositionSizeUsd: 10_000,
  cooldownMs: 60_000,           // 1-minute cooldown after exit
  enabled: true,

  hedgeRatioMethod: "fixed",
  fixedHedgeRatio: 1.0,

  entryZScore: 2.0,             // Enter when |z-score| > 2.0
  exitZScore: 0.5,              // Exit when |z-score| < 0.5
  stopLossZScore: 4.0,          // Emergency stop at |z-score| = 4.0
  maxHoldingTimeMs: 86_400_000, // Force-exit after 24 hours
  minObservations: 30,          // Need 30 data points for reliable stats

  tradeNotionalUsd: 5_000,      // $5,000 per leg
  priceSource: "mid",
};

/**
 * Creates a complete PairsStrategyConfig by merging defaults with the
 * provided overrides. A new ID is assigned unless one is provided.
 *
 * @param leg1 - Primary symbol
 * @param leg2 - Secondary symbol
 * @param overrides - Optional partial config to override defaults
 * @returns Complete PairsStrategyConfig
 */
export function createPairsConfig(
  leg1: Symbol,
  leg2: Symbol,
  overrides: Partial<PairsStrategyConfig> = {},
): PairsStrategyConfig {
  return {
    ...DEFAULT_PAIRS_CONFIG,
    id: newId(),
    leg1Symbol: leg1,
    leg2Symbol: leg2,
    symbols: [leg1, leg2],
    name: `Pairs: ${leg1}/${leg2}`,
    ...overrides,
  };
}
