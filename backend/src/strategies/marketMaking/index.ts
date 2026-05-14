/**
 * strategies/marketMaking/index.ts
 *
 * Re-exports the Avellaneda-Stoikov inventory-aware market making strategy.
 *
 * Model summary:
 *   reservationPrice = mid − (inventory − target) × γ × σ² × (T − t)
 *   halfSpread       = ½ · ( γ × σ² × (T − t) + (2/γ) × ln(1 + γ/κ) )
 *   bid = reservation − halfSpread,  ask = reservation + halfSpread
 *
 * See ./avellanedaStoikovStrategy.ts and backend/docs/strategies/avellaneda_stoikov.md
 * for full documentation, parameter reference, and limitations.
 *
 * Inputs:  EvaluationContext with quote/mid state and current inventory.
 * Outputs: A StrategySignal with two-sided quotes in meta.makerQuotes,
 *          or null when no quote should be emitted.
 */

export { AvellanedaStoikovStrategy } from "./avellanedaStoikovStrategy";
export {
  createAvellanedaStoikovConfig,
  getAvellanedaStoikovPreset,
  validateAvellanedaStoikovConfig,
  DEFAULT_AVELLANEDA_STOIKOV_CONFIG,
} from "./avellanedaStoikovConfig";
export type {
  AvellanedaStoikovConfig,
  AvellanedaStoikovInternalState,
  MakerQuote,
  MakerQuotesMeta,
  VolatilityEstimator,
} from "./avellanedaStoikovTypes";
export type { AvellanedaStoikovPreset } from "./avellanedaStoikovConfig";
