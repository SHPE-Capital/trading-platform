/**
 * strategies/pairs/index.ts
 *
 * Re-exports all pairs trading strategy modules.
 */

export { PairsStrategy } from "./pairsStrategy";
export { createPairsConfig, DEFAULT_PAIRS_CONFIG } from "./pairsConfig";
export type { PairsStrategyConfig, PairsInternalState, PairsSignalMeta, PairsPositionState, HedgeRatioMethod } from "./pairsTypes";
