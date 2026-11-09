/**
 * strategies/team3Reversal/filters/types.ts
 *
 * What every filter receives. An entry filter answers "may the baseline take
 * this trade?"; the exit rule answers "should we close the position now?".
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

/** Everything an entry filter can look at when the baseline wants to trade. */
export interface EntryInput {
  /** The symbol the baseline wants to trade. */
  symbol: string;
  /** The bar that just closed. */
  bar: BarView;
  /** This symbol's earlier bars, oldest first, ending with the bar right before `bar`. */
  history: readonly BarView[];
  /** Fractional change of `bar.close` versus the previous close (0.001 = +0.1%). */
  move: number;
  /** What the baseline wants to do: sell after an up bar, buy after a down bar. */
  side: "buy" | "sell";
  /** Another symbol's recent bars (oldest first, including its latest), e.g. barsOf("SPY"). */
  barsOf: (symbol: string) => readonly BarView[];
  /** All settings, including this filter's knob. */
  config: Team3ReversalConfig;
}

/** Return true to let the trade through, false to block it. */
export type EntryFilter = (input: EntryInput) => boolean;

/** Everything the exit rule can look at while a position is open. */
export interface ExitInput {
  symbol: string;
  /** The bar that just closed. */
  bar: BarView;
  /** This symbol's earlier bars, oldest first. */
  history: readonly BarView[];
  /** Current shares held: positive = long, negative = short. Never 0 here. */
  positionQty: number;
  /** Close of the bar we entered on. */
  entryPrice: number;
  /** Bars that have closed since we entered (1 on the first bar after entry). */
  barsHeld: number;
  barsOf: (symbol: string) => readonly BarView[];
  config: Team3ReversalConfig;
}

/** Return true to close the whole position on this bar. */
export type ExitRule = (input: ExitInput) => boolean;
