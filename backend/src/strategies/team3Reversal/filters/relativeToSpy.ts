/**
 * strategies/team3Reversal/filters/relativeToSpy.ts
 *
 * Filter: Relative to the market.  Switch: useRelativeToSpy  Knob: benchmarkSymbol
 * Owner: (your name here)
 *
 * Idea in plain words: when the whole market moves, the move comes back less.
 * Compare this stock's move with the benchmark's (SPY's) move over the same
 * minute, and only let the trade through when the stock moved much more than
 * the market did, in the same direction the baseline is fading.
 *
 * Useful tools:
 *   - input.move: this stock's move.
 *   - input.barsOf(input.config.benchmarkSymbol): SPY's recent bars.
 *
 * Watch out: bars for different symbols arrive one at a time, so SPY's bar
 * for this minute may not have arrived yet. Find the SPY bar whose ts equals
 * input.bar.ts; if there isn't one, decide what to do and write it down.
 *
 * Steps: 1) write your rule as a comment, 2) code it below, 3) make
 * src/tests/strategy/team3Reversal/relativeToSpy.test.ts describe your rule.
 */

import type { EntryFilter } from "./types";

export const relativeToSpyAllows: EntryFilter = (_input) => {
  // TODO: your rule. Until then every trade goes through (same as the baseline).
  return true;
};
