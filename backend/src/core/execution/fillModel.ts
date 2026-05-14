/**
 * core/execution/fillModel.ts
 *
 * Configurable bar-level fill model for simulated execution.
 *
 * Inputs:
 *   - OrderIntent (qty, side, order type, optional limit price)
 *   - Bar reference (next-bar OHLCV used for the reference price and volume cap)
 *   - FillModelConfig (slippage, spread, volume participation cap, partial-fill policy)
 *
 * Outputs:
 *   - FillModelDecision describing whether the order fills (full / partial / rejected),
 *     the fill qty, the fill price, and a human-readable reason on rejections.
 *
 * Design notes:
 *   - The reference price defaults to the next bar's open ("next_open"), preserving
 *     no-lookahead semantics. Strategies that wish to evaluate against close-to-open
 *     dynamics can opt-in via the `referencePrice` parameter on the config.
 *   - Slippage is applied as a configurable basis-point shift in the adverse direction.
 *   - Bid/ask is synthesized from the bar's reference price using a configurable
 *     half-spread (basis points) when no quote data is available; market buys cross
 *     the ask, market sells hit the bid.
 *   - Limit orders are honored: a buy fills only if the chosen fill price ≤ limitPrice;
 *     a sell only if ≥ limitPrice. Unfilled IOC orders are rejected (caller handles
 *     event publication).
 *   - Volume participation cap is applied as max(volume * participationPct) using the
 *     bar's volume. If qty exceeds the cap, the order partially fills up to the cap
 *     and the IOC remainder is reported as rejected (the caller must surface the
 *     rejection accordingly).
 *
 * This module is pure: it has no side effects and no dependency on the EventBus.
 */

import type { OrderIntent } from "../../types/orders";
import type { Bar } from "../../types/market";

/** Reference price strategy used to derive the simulated fill price for a bar. */
export type FillReferencePrice = "next_open" | "next_close" | "next_vwap";

/** Outcome of evaluating the fill model for a single intent against one bar. */
export type FillModelOutcome = "filled" | "partial" | "rejected";

/** Decision returned by the fill model. */
export interface FillModelDecision {
  /** Outcome category. */
  outcome: FillModelOutcome;
  /** Quantity filled (zero if rejected). */
  filledQty: number;
  /** Fill price (only meaningful when outcome != rejected). */
  fillPrice: number | null;
  /** Remaining qty after this fill (only meaningful for IOC: > 0 ⇒ remainder rejected). */
  remainingQty: number;
  /** Human-readable reason, populated for rejected/partial outcomes. */
  reason?: string;
}

/**
 * Configuration for the bar fill model.
 *
 * Defaults are conservative — slippage 5 bps, half-spread 2 bps, 10% volume
 * participation cap — matching the original SimulatedExecutionSink behavior
 * for liquid US equities. Override any field on a per-backtest basis via
 * BacktestConfig.fillModel.
 */
export interface FillModelConfig {
  /**
   * Reference price strategy. Default: "next_open" — uses bar.open of the bar
   * that follows the bar on which the intent was submitted. This is the most
   * common "no-lookahead" assumption.
   */
  referencePrice: FillReferencePrice;
  /** Slippage in basis points. Applied adversely (buys up, sells down). */
  slippageBps: number;
  /**
   * Half-spread in basis points used to synthesize bid/ask around the reference
   * price when no live quote is available. Market buys cross the ask
   * (reference * (1 + halfSpread)); market sells hit the bid.
   */
  halfSpreadBps: number;
  /**
   * Maximum fraction of a single bar's traded volume that a simulated order may
   * consume. Range [0, 1]. Default: 0.1 (10%). Set to >=1 to disable the cap.
   */
  volumeParticipationCap: number;
  /**
   * If true, an order whose qty exceeds the bar's volume cap fills partially
   * (up to the cap) instead of being fully rejected. IOC orders forward the
   * unfilled remainder as a rejection. Default: true.
   */
  allowPartialFills: boolean;
  /** Commission per share applied to filled qty. Used for accounting only. */
  commissionPerShare: number;
}

/** Conservative defaults; see field-level docs. */
export const DEFAULT_FILL_MODEL: FillModelConfig = {
  referencePrice: "next_open",
  slippageBps: 5,
  halfSpreadBps: 2,
  volumeParticipationCap: 0.1,
  allowPartialFills: true,
  commissionPerShare: 0.005,
};

/**
 * Picks the reference price from a bar according to the configured strategy.
 * Returns null when the chosen price is missing or non-finite.
 */
export function pickReferencePrice(bar: Bar, strategy: FillReferencePrice): number | null {
  let price: number | undefined;
  switch (strategy) {
    case "next_open":
      price = bar.open;
      break;
    case "next_close":
      price = bar.close;
      break;
    case "next_vwap":
      price = bar.vwap ?? bar.open;
      break;
  }
  if (price === undefined || !Number.isFinite(price) || price <= 0) return null;
  return price;
}

/**
 * Evaluates the fill model for the given intent against the reference bar.
 * Pure function; does not mutate inputs.
 *
 * @param intent - Order intent being evaluated.
 * @param bar - The bar whose open/close/vwap provides the reference price and
 *              whose volume feeds the participation cap.
 * @param config - Fill model configuration (use DEFAULT_FILL_MODEL for defaults).
 */
export function evaluateFill(
  intent: OrderIntent,
  bar: Bar,
  config: FillModelConfig = DEFAULT_FILL_MODEL,
): FillModelDecision {
  if (!Number.isFinite(intent.qty) || intent.qty <= 0) {
    return {
      outcome: "rejected",
      filledQty: 0,
      fillPrice: null,
      remainingQty: intent.qty,
      reason: "Invalid qty",
    };
  }

  const refPrice = pickReferencePrice(bar, config.referencePrice);
  if (refPrice === null) {
    return {
      outcome: "rejected",
      filledQty: 0,
      fillPrice: null,
      remainingQty: intent.qty,
      reason: "No valid reference price available for simulated fill",
    };
  }

  const halfSpread = config.halfSpreadBps / 10_000;
  const slippage = config.slippageBps / 10_000;

  // Cross the spread for market orders; limit orders use refPrice itself as
  // the basis (capped by limitPrice below).
  let priceBeforeSlippage: number;
  if (intent.side === "buy") {
    priceBeforeSlippage = refPrice * (1 + halfSpread);
  } else {
    priceBeforeSlippage = refPrice * (1 - halfSpread);
  }

  // Apply adverse slippage.
  const fillPrice =
    intent.side === "buy"
      ? priceBeforeSlippage * (1 + slippage)
      : priceBeforeSlippage * (1 - slippage);

  if (!Number.isFinite(fillPrice) || fillPrice <= 0) {
    return {
      outcome: "rejected",
      filledQty: 0,
      fillPrice: null,
      remainingQty: intent.qty,
      reason: "Computed fill price was non-positive",
    };
  }

  // Limit-order check
  if (intent.orderType === "limit" || intent.orderType === "stop_limit") {
    if (intent.limitPrice === undefined || !Number.isFinite(intent.limitPrice)) {
      return {
        outcome: "rejected",
        filledQty: 0,
        fillPrice: null,
        remainingQty: intent.qty,
        reason: "Limit order missing limitPrice",
      };
    }
    const crosses =
      intent.side === "buy" ? fillPrice <= intent.limitPrice : fillPrice >= intent.limitPrice;
    if (!crosses) {
      return {
        outcome: "rejected",
        filledQty: 0,
        fillPrice: null,
        remainingQty: intent.qty,
        reason: "Limit price not crossed by reference price",
      };
    }
  }

  // Volume participation cap. Volume can legitimately be 0 for halt bars; in
  // that case we reject rather than invent a fill.
  const volume = Number.isFinite(bar.volume) ? Math.max(0, bar.volume) : 0;
  if (volume === 0) {
    return {
      outcome: "rejected",
      filledQty: 0,
      fillPrice: null,
      remainingQty: intent.qty,
      reason: "Bar volume is zero — no liquidity to fill against",
    };
  }

  let cap = Math.floor(volume * config.volumeParticipationCap);
  if (config.volumeParticipationCap >= 1) cap = intent.qty; // disabled
  if (cap <= 0) cap = 1; // never round down to zero on tiny-volume bars when participation > 0

  if (intent.qty <= cap) {
    return {
      outcome: "filled",
      filledQty: intent.qty,
      fillPrice,
      remainingQty: 0,
    };
  }

  // Qty exceeds participation cap.
  if (!config.allowPartialFills) {
    return {
      outcome: "rejected",
      filledQty: 0,
      fillPrice: null,
      remainingQty: intent.qty,
      reason: "Qty exceeds volume participation cap; partial fills disabled",
    };
  }
  return {
    outcome: "partial",
    filledQty: cap,
    fillPrice,
    remainingQty: intent.qty - cap,
    reason: "Capped by volume participation",
  };
}
