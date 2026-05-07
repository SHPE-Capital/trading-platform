/**
 * core/sizing/kellyFractionalSizer.ts
 *
 * Kelly Criterion fractional position sizer. Sizes positions based on the
 * theoretical optimal fraction of capital derived from recent win/loss statistics.
 * A configurable Kelly fraction (default 0.5 = half-Kelly) is applied for robustness,
 * since full Kelly is theoretically optimal but too aggressive for real-world trading.
 *
 * Formula: f* = winRate - (1 - winRate) / odds
 *          adjustedF = f* * kellyFraction
 *          notional = min(maxNotionalUsd, adjustedF * portfolioEquity)
 *          qty = floor(notional / estimatedPrice)
 *
 * Inputs:  PositionSizerParams; uses realized PnL history from portfolio state.
 * Outputs: Integer quantity based on available capital × adjusted Kelly fraction.
 *
 * Status: SCAFFOLDED — computeQty() returns 0 until implementation is complete.
 * See backend/docs/position-sizing-layer.md for the full implementation guide.
 */

import { logger } from "../../utils/logger";
import type { SizerType } from "../../types/common";
import type { IPositionSizer, PositionSizerParams } from "./IPositionSizer";

export class KellyFractionalSizer implements IPositionSizer {
  readonly type: SizerType = "kelly_fractional";

  /**
   * @param kellyFraction - Multiplier applied to f* (0.5 = half-Kelly, recommended)
   * @param maxNotionalUsd - Hard cap on notional regardless of Kelly output
   * @param minTrades - Minimum closed trades required before using Kelly (default 10)
   */
  constructor(
    private readonly kellyFraction: number = 0.5,
    private readonly maxNotionalUsd: number,
    private readonly minTrades: number = 10,
  ) {}

  /**
   * Computes Kelly-fractional quantity from recent trade history.
   * @param params - PositionSizerParams
   * @returns Integer quantity (0 until implemented or if trade history is insufficient)
   */
  computeQty(params: PositionSizerParams): number {
    // TODO: Retrieve recent closed trade history from params.portfolio.
    //   The PortfolioStateManager will need a getClosedTrades() or equivalent method.
    // TODO: Return 0 if closedTrades.length < this.minTrades (insufficient history).
    // TODO: winRate = closedTrades.filter(t => t.realizedPnl > 0).length / closedTrades.length.
    // TODO: avgWin = mean of realizedPnl for winning trades.
    // TODO: avgLoss = mean of Math.abs(realizedPnl) for losing trades.
    // TODO: If avgLoss === 0, return 0 (cannot compute Kelly — no losses yet).
    // TODO: odds = avgWin / avgLoss.
    // TODO: f* = winRate - (1 - winRate) / odds. Clip f* to [0, 1].
    // TODO: adjustedF = f* * this.kellyFraction.
    // TODO: equity = params.portfolio.getSnapshot().equity.
    // TODO: notional = Math.min(this.maxNotionalUsd, adjustedF * equity).
    // TODO: Return Math.floor(notional / params.estimatedPrice).
    logger.warn("KellyFractionalSizer: not yet implemented, returning 0", {
      symbol: params.symbol,
      kellyFraction: this.kellyFraction,
      maxNotionalUsd: this.maxNotionalUsd,
      minTrades: this.minTrades,
    });
    return 0;
  }
}
