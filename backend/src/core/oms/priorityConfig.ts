/**
 * core/oms/priorityConfig.ts
 *
 * Hard-coded strategy priority map for OMS queue ordering.
 * Higher values are dequeued (executed) first.
 *
 * Customization: Edit STRATEGY_PRIORITY values to change execution
 * priority between strategy types. This is intentionally kept in code
 * (not in DB) for visibility and to avoid per-signal DB queries.
 *
 * Inputs:  Strategy type string, optional confidence and urgency.
 * Outputs: Numeric priority value for the OrderIntentQueue.
 */

import type { StrategyType } from "../../types/strategy";

// ------------------------------------------------------------------
// Base priority by strategy type
// ------------------------------------------------------------------

/**
 * Base priority for each strategy type.
 * All strategies start at equal priority (100).
 * Adjust values here to give certain strategy types execution priority.
 *
 * Examples:
 *   - Set arbitrage to 200 to always execute before momentum (100)
 *   - Set market_making to 150 for intermediate priority
 */
const STRATEGY_PRIORITY: Record<string, number> = {
  pairs_trading: 100,
  momentum: 100,
  arbitrage: 100,
  market_making: 100,
  neural_network: 100,
};

/** Default priority for any strategy type not in the map */
const DEFAULT_PRIORITY = 100;

// ------------------------------------------------------------------
// Priority functions
// ------------------------------------------------------------------

/**
 * Returns the base priority for a strategy type.
 * @param strategyType - Strategy type string
 * @returns Base priority value (higher = executed first)
 */
export function getStrategyPriority(strategyType: string): number {
  return STRATEGY_PRIORITY[strategyType] ?? DEFAULT_PRIORITY;
}

/**
 * Computes the final queue priority for a signal, combining:
 * - Base strategy priority
 * - Signal confidence bonus (0–1 scaled to 0–10)
 * - Urgency bonus (0–10, from signal meta)
 *
 * Formula: basePriority + (confidence × 10) + (urgency × 5)
 *
 * @param strategyType - Strategy type for base priority lookup
 * @param confidence - Signal confidence score (0–1), optional
 * @param urgency - Urgency multiplier (0–10), optional
 * @returns Final priority value for queue ordering
 */
export function getSignalPriority(
  strategyType: string,
  confidence?: number,
  urgency?: number,
): number {
  const base = getStrategyPriority(strategyType);
  const confidenceBonus = (confidence ?? 0) * 10;
  const urgencyBonus = (urgency ?? 0) * 5;
  return base + confidenceBonus + urgencyBonus;
}
