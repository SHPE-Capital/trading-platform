/**
 * strategies/team3Reversal/sizing.ts
 *
 * Volatility-targeted size (switch: useVolSizing, knob: riskPerTradeUsd).
 *
 * In plain words: decide how many dollars a typical 1-minute move may cost us,
 * then buy fewer shares of jumpy stocks and more of calm ones.
 *   sigma         = standard deviation of recent 1-minute returns
 *   move per share = sigma x price            (dollars)
 *   qty           = floor(riskPerTradeUsd / move per share)
 * The strategy then caps qty so the position never passes maxPositionQty.
 * Docs: docs/team3/components/vol-sizing.md
 *
 * Owner: team lead.
 */

import { computeStdDev } from "../../services/indicators";
import type { BarView } from "./filters/types";

/** Fewest returns we accept before trusting sigma; with fewer the size is 0 (no trade). */
export const MIN_RETURNS_FOR_SIZING = 5;

/** Shares to trade for `bar` given its recent `history`. 0 means "not enough data or too volatile". */
export function volTargetQty(history: readonly BarView[], bar: BarView, riskPerTradeUsd: number): number {
  const closes = [...history.map((b) => b.close), bar.close];
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) returns.push(closes[i] / closes[i - 1] - 1);
  }
  if (returns.length < MIN_RETURNS_FOR_SIZING || bar.close <= 0) return 0;
  const sigma = computeStdDev(returns);
  if (!(sigma > 0)) return 0;
  return Math.floor(riskPerTradeUsd / (sigma * bar.close));
}
