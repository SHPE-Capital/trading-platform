/**
 * core/sizing/volatilityScaledSizer.ts
 *
 * Volatility-scaled position sizer. Adjusts notional exposure inversely
 * proportional to realized volatility: higher vol → smaller position,
 * lower vol → larger position (up to maxNotionalUsd).
 *
 * Formula: scaledNotional = min(maxNotionalUsd, baseNotional * (targetVol / realizedVol))
 *          qty = floor(scaledNotional / estimatedPrice)
 *
 * Inputs:  PositionSizerParams; uses services/indicators/volatility.ts internally.
 * Outputs: Integer quantity scaled by the targetVol/realizedVol ratio.
 *
 * Status: SCAFFOLDED — computeQty() returns 0 until implementation is complete.
 * See backend/docs/position-sizing-layer.md for the full implementation guide.
 */

import { logger } from "../../utils/logger";
import type { SizerType } from "../../types/common";
import type { IPositionSizer, PositionSizerParams } from "./IPositionSizer";

export class VolatilityScaledSizer implements IPositionSizer {
  readonly type: SizerType = "volatility_scaled";

  /**
   * @param targetVol - Target annualized volatility fraction (e.g. 0.15 = 15%)
   * @param baseNotionalUsd - Base notional USD before vol scaling
   * @param maxNotionalUsd - Hard cap on scaled notional regardless of vol ratio
   */
  constructor(
    private readonly targetVol: number,
    private readonly baseNotionalUsd: number,
    private readonly maxNotionalUsd: number,
  ) {}

  /**
   * Computes volatility-scaled quantity.
   * @param params - PositionSizerParams
   * @returns Integer quantity (0 until implemented)
   */
  computeQty(params: PositionSizerParams): number {
    // TODO: Retrieve mid-price history for params.symbol from params.symbolState.
    //   const symState = params.symbolState.get(params.symbol);
    //   const midPrices = symState?.midPrices.getAll().map(e => e.value) ?? [];
    // TODO: Import and call computeRealizedVolatility(midPrices) from
    //   @/services/indicators/volatility. This returns annualized stddev.
    // TODO: If realizedVol is null, NaN, or 0, fall back to FixedNotionalSizer:
    //   return new FixedNotionalSizer().computeQty(params).
    // TODO: scaledNotional = Math.min(this.maxNotionalUsd, this.baseNotionalUsd * (this.targetVol / realizedVol)).
    // TODO: Return Math.floor(scaledNotional / params.estimatedPrice).
    logger.warn("VolatilityScaledSizer: not yet implemented, returning 0", {
      symbol: params.symbol,
      targetVol: this.targetVol,
      maxNotionalUsd: this.maxNotionalUsd,
    });
    return 0;
  }
}
