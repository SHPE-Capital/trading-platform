/**
 * strategies/team3Reversal/contract/frame.ts
 *
 * READ side of the contract: turns the platform's EvaluationContext into a
 * MinuteFrame, the only market view the rest of the strategy sees.
 *
 * Platform facts this relies on (CONTRACT.md, "Platform gives us"):
 *   - evaluate() runs once per (bar timestamp, symbol), symbols in alphabetical order;
 *   - before any evaluate() at a timestamp, symbolState already holds every
 *     symbol's bar for that timestamp. So reading other symbols from symbolState
 *     (not from our own history) gives the same-minute cross-section.
 *
 * Owner: team lead.
 */

import type { EvaluationContext } from "../../base/strategy";
import type { Bar } from "../../../types/market";
import type { BarView } from "../filters/types";

export interface MinuteFrame {
  /** The symbol this call is about. */
  symbol: string;
  /** Its bar that just closed. */
  bar: BarView;
  /** Latest bar of each of our symbols (this minute's, if it has arrived). */
  latest: ReadonlyMap<string, BarView>;
  /** Latest close of a symbol, or null if it has no bar yet. */
  priceOf: (symbol: string) => number | null;
}

const toView = (b: Bar): BarView => ({ ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });

/** Builds the frame, or null if this symbol has no bar yet. */
export function readFrame(ctx: EvaluationContext, symbols: readonly string[]): MinuteFrame | null {
  const latest = new Map<string, BarView>();
  for (const s of symbols) {
    const b = ctx.symbolState.get(s)?.latestBar;
    if (b) latest.set(s, toView(b));
  }
  const bar = latest.get(ctx.symbol);
  if (!bar) return null;
  return { symbol: ctx.symbol, bar, latest, priceOf: (s) => latest.get(s)?.close ?? null };
}
