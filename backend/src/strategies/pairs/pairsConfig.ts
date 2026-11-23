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
import type { Symbol, ExecutionAlgoType } from "../../types/common";

/**
 * Default deadband applied either side of the Engle-Granger critical value.
 *
 * Sized from observed XOM/CVX behaviour: with a long OLS window the test
 * statistic stabilises and then jitters by a few thousandths per recalculation.
 * 0.15 is wide enough to absorb that noise while still reacting to a genuine
 * regime change, which moves tau by several tenths.
 */
export const DEFAULT_COINT_HYSTERESIS = 0.15;

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
  fixedHedgeRatio: 1,

  entryZScore: 2,               // Enter when |z-score| > 2
  exitZScore: 0.5,              // Exit when |z-score| < 0.5
  stopLossZScore: 4,            // Emergency stop at |z-score| = 4
  maxHoldingTimeMs: 86_400_000, // Force-exit after 24 hours
  minObservations: 30,          // Need 30 data points for reliable stats

  tradeNotionalUsd: 5_000,      // $5,000 per leg
  priceSource: "mid",

  olsWindowMs: 14_400_000,     // 4-hour OLS window (2× the spread window)
  olsRecalcIntervalBars: 5,    // Recompute hedge ratio every 5 bars
  cointSignificanceLevel: 0.05, // Block entry when EG test p > 5%
  cointHysteresis: DEFAULT_COINT_HYSTERESIS, // Deadband so the gate cannot flap

  executionAlgo: "market" as ExecutionAlgoType,
  // TODO: Change executionAlgo to "twap" or "vwap" for large-notional trades to reduce
  // market impact once TwapExecutionAlgo and VwapExecutionAlgo are implemented in
  // core/execution/algos/. Register them in ExecutionEngine._algos (executionEngine.ts).
};

/** Shortest hold the strategy can honour: it only decides once per one-minute bar. */
export const MIN_HOLDING_TIME_MS = 60_000;

/** Longest accepted hold (1 year); anything larger is almost certainly a unit mistake. */
export const MAX_HOLDING_TIME_MS = 527_040 * 60_000;

/**
 * Rejects a config whose max-hold limit would be unenforceable or silently off.
 * A NaN or undefined limit makes every `age >= limit` comparison false, so the
 * forced exit would never fire.
 * @throws Error naming the problem
 */
export function validatePairsConfig(config: Pick<PairsStrategyConfig, "maxHoldingTimeMs">): void {
  const ms = config.maxHoldingTimeMs;
  if (typeof ms !== "number" || !Number.isInteger(ms)) {
    throw new Error(`pairs_trading: maxHoldingTimeMs must be a whole number of milliseconds (got ${ms})`);
  }
  if (ms < MIN_HOLDING_TIME_MS) {
    throw new Error(
      `pairs_trading: maxHoldingTimeMs must be at least one minute (${MIN_HOLDING_TIME_MS} ms), got ${ms}`,
    );
  }
  if (ms > MAX_HOLDING_TIME_MS) {
    throw new Error(
      `pairs_trading: maxHoldingTimeMs of ${ms} ms is over the 1 year maximum (${MAX_HOLDING_TIME_MS} ms). ` +
        `The value is in milliseconds, not minutes.`,
    );
  }
}

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
