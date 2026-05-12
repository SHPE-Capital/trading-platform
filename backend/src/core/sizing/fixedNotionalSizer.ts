/**
 * core/sizing/fixedNotionalSizer.ts
 *
 * Fixed notional position sizer. Computes quantity as:
 *   qty = floor(strategyConfig.maxPositionSizeUsd / estimatedPrice)
 *
 * This is the direct refactoring of PairsStrategy._computeQty(). Once this
 * sizer is wired into the orchestrator, the _computeQty() method in
 * pairsStrategy.ts should be removed (see TODO comment there).
 *
 * Inputs:  PositionSizerParams (uses strategyConfig.maxPositionSizeUsd and estimatedPrice).
 * Outputs: Integer quantity (0 if estimatedPrice is zero or negative).
 */

import { logger } from "../../utils/logger";
import type { SizerType } from "../../types/common";
import type { IPositionSizer, PositionSizerParams } from "./IPositionSizer";

export class FixedNotionalSizer implements IPositionSizer {
  readonly type: SizerType = "fixed_notional";

  /**
   * Computes qty = floor(maxPositionSizeUsd / estimatedPrice).
   * Returns 0 if estimatedPrice is zero or negative.
   * @param params - PositionSizerParams
   * @returns Integer quantity
   */
  computeQty(params: PositionSizerParams): number {
    if (params.estimatedPrice <= 0) {
      logger.warn("FixedNotionalSizer: estimatedPrice <= 0, returning qty 0", {
        symbol: params.symbol,
        estimatedPrice: params.estimatedPrice,
      });
      return 0;
    }

    const qty = Math.floor(params.strategyConfig.maxPositionSizeUsd / params.estimatedPrice);

    logger.info("FixedNotionalSizer: computed qty", {
      symbol: params.symbol,
      maxPositionSizeUsd: params.strategyConfig.maxPositionSizeUsd,
      estimatedPrice: params.estimatedPrice,
      qty,
    });

    return qty;
  }
}
