/**
 * strategies/team3Reversal/filters/types.ts
 *
 * What every entry filter receives. A filter answers "may the baseline take
 * this trade?". Exits are part of the baseline (see ../rules.ts).
 *
 * Owner: team lead. Teammates read this; they do not edit it.
 */

import type { Team3ReversalConfig } from "../team3ReversalConfig";

/** One 1-minute bar, as the filters see it. ts is the bar's start time (ms since 1970, UTC). */
export interface BarView {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * This symbol's session VWAP picture after the bar that just closed (see ../vwap.ts).
 * null until some volume has traded in today's regular session.
 */
export interface VwapView {
  /** Volume-weighted average price since 9:30 ET today. */
  vwap: number;
  /** Volume-weighted standard deviation of typical price around VWAP. */
  sigma: number;
  /** (close - vwap) / sigma; null while sigma is 0. */
  z: number | null;
  /** Regular-session bars seen today, this one included. */
  sessionBars: number;
  /** Times the close switched sides of VWAP over the last vwapWindowBars session bars. */
  crossings: number;
}

/** Everything an entry filter can look at when the baseline wants to trade. */
export interface EntryInput {
  /** The symbol the baseline wants to trade. */
  symbol: string;
  /** The bar that just closed. */
  bar: BarView;
  /** Today's earlier session bars for this symbol (last lookbackBars), oldest first, ending right before `bar`. */
  history: readonly BarView[];
  /** Fractional change of `bar.close` versus the previous session close today (0.001 = +0.1%). */
  move: number;
  /** What the baseline wants to do: sell after an up bar, buy after a down bar. */
  side: "buy" | "sell";
  /** Another symbol's session bars today, oldest first, including this same minute's bar if it has one, e.g. barsOf("SPY"). */
  barsOf: (symbol: string) => readonly BarView[];
  /** This symbol's session VWAP after this bar, or null before any volume today. */
  vwap: VwapView | null;
  /** All settings, including this filter's knob. */
  config: Team3ReversalConfig;

}

/** Return true to let the trade through, false to block it. */
export type EntryFilter = (input: EntryInput) => boolean;
