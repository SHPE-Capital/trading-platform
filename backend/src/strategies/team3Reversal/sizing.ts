/**
 * strategies/team3Reversal/sizing.ts
 *
 * How many shares a new entry wants, before risk.ts caps it.
 *   fixedNotionalQty  baseline: the same dollars per trade on every symbol
 *   volTargetQty      switch useVolSizing (knob riskPerTradeUsd):
 *     sigma          = standard deviation of today's 1-minute session returns
 *     move per share = sigma x price            (dollars)
 *     qty            = floor(riskPerTradeUsd / move per share)
 * The strategy passes only today's session bars, so pre-market and the
 * overnight gap never shrink or inflate sigma (bug 1).
 * Docs: docs/team3/components/vol-sizing.md
 *
 * Owner: team lead.
 */

import { computeStdDev } from "../../services/indicators";
import type { BarView } from "./filters/types";

/** Fewest returns we accept before trusting sigma; with fewer the size is 0 (no trade). */
export const MIN_RETURNS_FOR_SIZING = 5;

/** Shares worth about tradeUsd at this price. */
export function fixedNotionalQty(tradeUsd: number, price: number): number {
  return price > 0 ? Math.floor(tradeUsd / price) : 0;
}

/** Shares to trade for `bar` given its earlier same-session bars. 0 means "not enough data or too volatile". */
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
