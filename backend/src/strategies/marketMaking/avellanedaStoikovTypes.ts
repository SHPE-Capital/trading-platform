/**
 * strategies/marketMaking/avellanedaStoikovTypes.ts
 *
 * TypeScript types specific to the Avellaneda-Stoikov inventory-aware
 * market-making strategy. Supplements the shared strategy types with
 * config, internal state, and signal metadata for two-sided quoting.
 *
 * Inputs:  N/A — type definitions only.
 * Outputs: N/A — type definitions only.
 */

import type { Symbol, EpochMs, ExecutionAlgoType } from "../../types/common";
import type { RollingTimeWindow } from "../../core/state/rollingWindow";

// ------------------------------------------------------------------
// Volatility Estimator
// ------------------------------------------------------------------

/**
 * Choice of short-term realized volatility estimator.
 * - "stddev_returns": sample std-dev of mid-to-mid log returns (default)
 * - "ewma_returns":   exponentially weighted moving variance of returns
 */
export type VolatilityEstimator = "stddev_returns" | "ewma_returns";

// ------------------------------------------------------------------
// Maker Quote (one side of a two-sided market making quote)
// ------------------------------------------------------------------

/**
 * A single resting limit-order quote produced by a market making strategy.
 * Two of these (one bid, one ask) are packed into MakerQuotesMeta and
 * carried on the StrategySignal so the orchestrator can emit paired
 * limit OrderIntents in a single dispatch.
 */
export interface MakerQuote {
  /** Which side of the book this quote sits on */
  side: "buy" | "sell";
  /** Limit price (already snapped to the configured tick size) */
  price: number;
  /** Quantity in shares/units (integer, after qty caps applied) */
  qty: number;
}

// ------------------------------------------------------------------
// Maker Quotes Metadata (signal.meta payload for two-sided quoting)
// ------------------------------------------------------------------

/**
 * Metadata attached to a StrategySignal that asks the orchestrator to
 * emit two-sided limit-order quotes (one buy, one sell). The signal's
 * top-level `direction` is "flat" and its `qty` is informational only —
 * the actual order quantities come from each leg of `makerQuotes`.
 *
 * If `makerQuotes` is empty (length 0), no orders are emitted.
 */
export interface MakerQuotesMeta {
  /** Discriminator used by the orchestrator to detect a market-making signal */
  kind: "maker_quotes";
  /** The bid and ask quotes to post (0, 1, or 2 entries) */
  makerQuotes: MakerQuote[];
  /** Time-in-force for each limit order. Defaults to "day" if omitted. */
  timeInForce?: "day" | "gtc" | "ioc";
  /** Reservation price the quotes are centered around (for logging/UI) */
  reservationPrice: number;
  /** Optimal half-spread (delta) the quotes were placed at (for logging/UI) */
  halfSpread: number;
  /** Volatility estimate used (annualized=false; per-bar-step variance proxy) */
  sigma: number;
  /** Current inventory in shares used when building the quotes */
  inventory: number;
  /** Mid price observed at quote-build time */
  midPrice: number;
  /**
   * Reason a side was suppressed, if any: "inventory_cap_long" means the
   * buy side was suppressed because long inventory hit the cap; similarly
   * for "inventory_cap_short" on the sell side; "kill_switch" means both
   * sides were suppressed.
   */
  suppression?: "inventory_cap_long" | "inventory_cap_short" | "kill_switch";
}

// ------------------------------------------------------------------
// Avellaneda-Stoikov Strategy Config
// ------------------------------------------------------------------

/**
 * Full configuration for an Avellaneda-Stoikov market making strategy.
 * Mirrors the BaseStrategyConfig shape and adds AS-specific parameters.
 *
 * Notation follows the original Avellaneda & Stoikov (2008) paper:
 *   r = s − q · γ · σ² · (T − t)             (reservation price)
 *   δ = γ · σ² · (T − t) + (2/γ) · ln(1 + γ/κ)  (optimal half-spread)
 * where s is mid, q is inventory, γ is risk aversion, σ is short-term
 * vol per bar, T-t is time remaining in the horizon, and κ is the
 * arrival-rate sensitivity (order-flow intensity proxy).
 */
export interface AvellanedaStoikovConfig {
  // ------- Inherited BaseStrategyConfig shape (duplicated for isolation) -------
  id: string;
  name: string;
  type: "market_making";
  /** Single symbol per strategy instance (kept as array for shape parity) */
  symbols: [Symbol];
  rollingWindowMs: number;
  maxPositionSizeUsd: number;
  cooldownMs: number;
  enabled: boolean;
  executionAlgo?: ExecutionAlgoType;

  // ------- AS-specific -------

  /** The instrument being quoted */
  symbol: Symbol;

  /**
   * Risk aversion coefficient (γ). Larger = wider spreads and stronger
   * inventory skew. Must be > 0. Typical range: 0.01 - 5.
   */
  gamma: number;

  /**
   * Order-flow intensity proxy (κ) used in the optimal-spread formula.
   * Higher κ implies more aggressive arrivals → tighter optimal spread.
   * Must be > 0. Typical range: 0.1 - 5.
   */
  kappa: number;

  /**
   * Trading horizon in milliseconds. Time-to-close (T - t) decays linearly
   * from `horizonMs` at strategy start toward 0 at end-of-horizon, then
   * resets each session (or stays clamped at floor — see clampHorizon).
   * Typical: a single trading session ≈ 6.5h = 23_400_000 ms.
   */
  horizonMs: number;

  /**
   * If true, (T - t) is clamped at `minHorizonFraction` of horizonMs
   * to prevent the spread term from collapsing to 0 near end-of-day.
   */
  clampHorizon: boolean;

  /**
   * Lower bound for (T - t)/horizonMs when clampHorizon is true. e.g. 0.05
   * means the horizon term never goes below 5% of horizonMs. Ignored when
   * clampHorizon is false.
   */
  minHorizonFraction: number;

  /**
   * Choice of volatility estimator over the mid-price returns window.
   */
  volEstimator: VolatilityEstimator;

  /**
   * Window size for the mid-price returns sample used to estimate σ.
   * Number of mid-price observations retained.
   */
  volWindowSize: number;

  /**
   * Decay parameter (λ) for the EWMA estimator, in (0, 1).
   * Higher λ = slower decay; ignored when volEstimator = "stddev_returns".
   */
  volEwmaLambda: number;

  /**
   * Fallback / floor σ used until volWindowSize samples are available, or
   * when the live estimate falls below this floor. Must be ≥ 0.
   * Units: same as returns (per-bar / per-tick, not annualized).
   */
  sigmaFloor: number;

  /**
   * Hard cap on σ used in the formulas (prevents pathological spreads when
   * realized vol spikes). Set to Infinity to disable. Must be > sigmaFloor.
   */
  sigmaCap: number;

  /**
   * Inventory target (shares). Reservation-price skew is computed relative
   * to this target rather than zero — typically left at 0 for pure MM.
   */
  inventoryTarget: number;

  /**
   * Hard inventory limit (absolute shares). When |inventory| ≥ limit the
   * strategy refuses to add to position in that direction (one side is
   * suppressed). Must be ≥ 0.
   */
  inventoryLimit: number;

  /** Base order quantity per side (shares). Integer ≥ 1. */
  baseOrderQty: number;

  /**
   * Maximum quantity per quote (shares). Acts as an upper bound on
   * baseOrderQty after any inventory-based scaling. Integer ≥ 1.
   */
  maxQuoteQty: number;

  /**
   * Minimum quote refresh / cooldown interval (ms). Prevents excessive
   * re-quoting when ticks arrive faster than this interval.
   */
  quoteRefreshMs: number;

  /** Minimum quoted spread (absolute price units). Quoted spread ≥ 2 × minHalfSpread. */
  minHalfSpread: number;

  /** Maximum quoted half-spread (absolute price units). Caps wide-vol blowups. */
  maxHalfSpread: number;

  /** Tick size for price snapping (absolute price units). Must be > 0. */
  tickSize: number;

  /**
   * Kill-switch: if realized σ exceeds this threshold the strategy
   * suppresses both sides. Use Infinity to disable.
   */
  killSwitchSigma: number;

  /**
   * Kill-switch: if |inventory| exceeds inventoryLimit by this multiplier
   * (e.g. 1.5), both sides are suppressed until inventory recovers.
   * Set to Infinity to disable.
   */
  killSwitchInventoryMult: number;

  /**
   * Minimum number of mid-price observations required before quoting.
   * Below this, evaluate() returns null (no quotes posted).
   */
  minObservations: number;

  /** Optional human-readable description carried into BaseStrategyConfig. */
  description?: string;
}

// ------------------------------------------------------------------
// Internal Runtime State
// ------------------------------------------------------------------

/** Per-instance runtime state maintained across evaluate() calls */
export interface AvellanedaStoikovInternalState {
  /** Rolling window of mid prices used to derive returns and σ */
  midWindow: RollingTimeWindow<number>;
  /** Cumulative count of mid prices ever pushed (for minObservations gate) */
  midObservations: number;
  /** Last quote-refresh timestamp (cooldown gate) */
  lastQuoteTs: EpochMs | null;
  /** Last computed reservation price (for diagnostics) */
  lastReservationPrice: number | null;
  /** Last computed half-spread (for diagnostics) */
  lastHalfSpread: number | null;
  /** Last computed σ used in formulas */
  lastSigma: number | null;
  /** EWMA variance state when volEstimator = "ewma_returns" */
  ewmaVariance: number | null;
  /** Last mid price observed (for return computation) */
  lastMid: number | null;
  /** Strategy start time used to compute (T - t) */
  startedAtMs: EpochMs | null;
  /** Total quote-signal emissions (diagnostics) */
  quoteEmissions: number;
  /** Number of times kill-switch suppressed both sides */
  killSwitchActivations: number;
}
