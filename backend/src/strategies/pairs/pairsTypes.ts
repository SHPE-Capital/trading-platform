/**
 * strategies/pairs/pairsTypes.ts
 *
 * TypeScript types specific to the pairs trading strategy.
 * These supplement the shared strategy types with pairs-specific
 * state, configuration, and derived metrics.
 *
 * Inputs:  N/A — type definitions only.
 * Outputs: N/A — type definitions only.
 */

import type { Symbol, EpochMs } from "../../types/common";
import type { RollingTimeWindow } from "../../core/state/rollingWindow";

// ------------------------------------------------------------------
// Hedge Ratio Method
// ------------------------------------------------------------------

/**
 * Method used to compute the hedge ratio between the two symbols.
 * - "fixed": User supplies a static ratio (e.g. 1.0, 0.5).
 * - "rolling_ols": Estimated via rolling OLS regression over the spread window.
 */
export type HedgeRatioMethod = "fixed" | "rolling_ols";

// ------------------------------------------------------------------
// Position State
// ------------------------------------------------------------------

/** Current position state of the pairs strategy */
export type PairsPositionState =
  | "flat"         // No position open
  | "long_spread"  // Long leg1, short leg2 (spread expanded below mean → expect reversion up)
  | "short_spread" // Short leg1, long leg2 (spread expanded above mean → expect reversion down)
  | "closing";     // Actively closing position

// ------------------------------------------------------------------
// Pairs Strategy Config
// ------------------------------------------------------------------

/**
 * Full configuration for a pairs trading strategy instance.
 * Extends BaseStrategyConfig with pairs-specific parameters.
 */
export interface PairsStrategyConfig {
  // ------- Inherited from BaseStrategyConfig (duplicated for isolation) -------
  id: string;
  name: string;
  type: "pairs_trading";
  symbols: [Symbol, Symbol]; // Exactly two symbols: [leg1, leg2]
  rollingWindowMs: number;
  maxPositionSizeUsd: number;
  cooldownMs: number;
  enabled: boolean;

  // ------- Pairs-specific -------

  /** Primary instrument (long when spread is low) */
  leg1Symbol: Symbol;
  /** Secondary instrument (short when spread is low) */
  leg2Symbol: Symbol;

  /** Method for estimating the hedge ratio */
  hedgeRatioMethod: HedgeRatioMethod;
  /**
   * Fixed hedge ratio: qty_leg2 = hedgeRatio × qty_leg1.
   * Required when hedgeRatioMethod = "fixed".
   */
  fixedHedgeRatio: number;

  /**
   * Z-score threshold to enter a long-spread or short-spread position.
   * Enter long spread when z < -entryZScore; enter short spread when z > entryZScore.
   */
  entryZScore: number;

  /**
   * Z-score threshold to exit a position (mean reversion target).
   * Exit when |z| < exitZScore.
   */
  exitZScore: number;

  /**
   * Z-score level for an emergency stop-loss exit.
   * Exit immediately if |z| exceeds this level (trade went against us).
   */
  stopLossZScore: number;

  /**
   * Maximum holding time for any open pairs position (milliseconds).
   * Forces exit if the spread has not reverted within this time.
   */
  maxHoldingTimeMs: number;

  /**
   * Duration of the rolling window used for OLS hedge ratio estimation (ms).
   * Should be longer than rollingWindowMs so the ratio is stable across
   * multiple spread cycles. Ignored when hedgeRatioMethod = "fixed".
   */
  olsWindowMs: number;

  /**
   * How often to recompute the OLS hedge ratio, in number of bars received.
   * Recomputing every bar is unnecessary and expensive; every 5–10 bars is typical.
   * Ignored when hedgeRatioMethod = "fixed".
   */
  olsRecalcIntervalBars: number;

  /**
   * Minimum number of spread observations required before trading.
   * Ensures the rolling statistics are meaningful.
   */
  minObservations: number;

  /**
   * Notional value per trade leg in USD.
   * e.g. 5000 means buy $5000 of leg1 and sell $5000×hedgeRatio of leg2.
   */
  tradeNotionalUsd: number;

  /** Price source to use for spread calculation: "mid" or "last_trade" */
  priceSource: "mid" | "last_trade";
}

// ------------------------------------------------------------------
// Pairs Strategy Runtime State
// ------------------------------------------------------------------

/** Internal runtime state maintained across ticks by the pairs strategy */
export interface PairsInternalState {
  /** Current position state */
  positionState: PairsPositionState;
  /** Timestamp when the current position was opened (null if flat) */
  positionOpenedAt: EpochMs | null;
  /** Last computed z-score */
  lastZScore: number | null;
  /** Last computed spread value */
  lastSpread: number | null;
  /** Rolling spread window for statistical calculations */
  spreadWindow: RollingTimeWindow<number>;
  /** Current estimated hedge ratio */
  currentHedgeRatio: number;
  /** Number of completed round-trip trades */
  completedTrades: number;
  /** Whether the cooldown period is active */
  cooldownActive: boolean;
  /** When the cooldown expires (Unix ms) */
  cooldownExpiresAt: EpochMs | null;
  /** Most recent leg1 price used for position sizing */
  latestLeg1Price: number | null;
  /** Price history window for leg1 used by rolling OLS */
  olsLeg1Window: RollingTimeWindow<number>;
  /** Price history window for leg2 used by rolling OLS */
  olsLeg2Window: RollingTimeWindow<number>;
  /** Bar count since last OLS recomputation */
  barsSinceOlsRecalc: number;
}

// ------------------------------------------------------------------
// Pairs Signal Metadata
// ------------------------------------------------------------------

/** Metadata attached to a StrategySignal from the pairs strategy */
export interface PairsSignalMeta {
  /** Z-score that triggered the signal */
  zScore: number;
  /** Spread value at signal time */
  spread: number;
  /** Rolling mean of the spread */
  spreadMean: number;
  /** Rolling std dev of the spread */
  spreadStd: number;
  /** Hedge ratio used */
  hedgeRatio: number;
  /** Which signal type this is */
  signalType: "entry_long" | "entry_short" | "exit" | "stop_loss" | "max_hold_exit";
  /** The counterpart symbol (for paired order generation) */
  counterpartSymbol: Symbol;
  /** Direction for the counterpart symbol */
  counterpartDirection: "long" | "short";
}
