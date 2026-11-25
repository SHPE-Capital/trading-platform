/**
 * strategies/team3Reversal/risk.ts
 *
 * Team 3's own caps (bugs 3, 4, 5). The platform reserves no cash for shorts
 * and enforces only account-wide caps, so the strategy enforces these itself:
 *   - per symbol: |shares| x price <= maxPositionSizeUsd
 *   - gross:      sum over symbols of |shares| x price <= maxGrossUsd
 * Longs and shorts count the same: a short is real exposure, not free cash.
 *
 * Owner: team lead. Pure: no platform imports.
 */

export interface Caps {
  maxSymbolUsd: number;
  maxGrossUsd: number;
}

export interface CapInput {
  /** Shares the sizing rule wants to add (>= 0). */
  want: number;
  price: number;
  /** This symbol's current |exposure| in dollars. */
  symbolUsd: number;
  /** Team 3's current gross exposure in dollars, pending orders included. */
  grossUsd: number;
}

/** Largest whole number of shares <= want that keeps both caps. 0 = no room. */
export function capQty({ want, price, symbolUsd, grossUsd }: CapInput, caps: Caps): number {
  if (!(price > 0) || want <= 0) return 0;
  const symbolRoom = (caps.maxSymbolUsd - symbolUsd) / price;
  const grossRoom = (caps.maxGrossUsd - grossUsd) / price;
  return Math.max(0, Math.floor(Math.min(want, symbolRoom, grossRoom)));
}

/** Gross dollars of a set of signed share positions, each at its latest price. */
export function grossUsd(positions: Iterable<[string, number]>, priceOf: (symbol: string) => number | null): number {
  let total = 0;
  for (const [symbol, qty] of positions) total += Math.abs(qty) * (priceOf(symbol) ?? 0);
  return total;
}
