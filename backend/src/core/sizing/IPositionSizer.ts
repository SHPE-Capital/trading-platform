/**
 * core/sizing/IPositionSizer.ts
 *
 * Contract for pluggable position sizing algorithms. Decouples quantity
 * computation from strategy logic so sizing can be changed independently
 * of the signal logic. Strategies emit signals; the orchestrator calls the
 * configured sizer to determine how many shares/units to trade.
 *
 * Inputs:  PositionSizerParams with all context needed for sizing.
 * Outputs: Integer quantity to trade (0 if sizing is not possible).
 */

import type { SizerType } from "../../types/common";
import type { SignalDirection, BaseStrategyConfig } from "../../types/strategy";
import type { PortfolioStateManager } from "../state/portfolioState";
import type { SymbolStateManager } from "../state/symbolState";

// ------------------------------------------------------------------
// Sizer Params
// ------------------------------------------------------------------

/**
 * All context a position sizer needs to compute order quantity.
 * Passed by the orchestrator after a strategy signal is received.
 */
export interface PositionSizerParams {
  /** Symbol to be traded */
  symbol: string;
  /** Signal direction (long, short, close_long, close_short) */
  direction: SignalDirection;
  /** Best estimated entry price (e.g. latest mid from symbol state) */
  estimatedPrice: number;
  /** Current portfolio state for cash and position information */
  portfolio: PortfolioStateManager;
  /** Current symbol state for rolling price/volume data */
  symbolState: SymbolStateManager;
  /** Config of the strategy that emitted the signal */
  strategyConfig: BaseStrategyConfig;
}

// ------------------------------------------------------------------
// Interface
// ------------------------------------------------------------------

/** Contract for all position sizing algorithm implementations. */
export interface IPositionSizer {
  /** Sizer type identifier — must match a registered SizerType */
  readonly type: SizerType;

  /**
   * Computes the quantity to trade for a given signal.
   * Always returns a non-negative integer (floored shares/units).
   * Returns 0 if sizing is not possible (e.g. zero price, insufficient data).
   * @param params - All context needed for qty computation
   * @returns Integer number of shares/units to trade
   */
  computeQty(params: PositionSizerParams): number;
}
