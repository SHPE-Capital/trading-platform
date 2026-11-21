/**
 * strategies/team3Reversal/filters/relativeToSpy.ts
 *
 * Filter: Relative to the market.  Switch: useRelativeToSpy  Knob: benchmarkSymbol
 * Owner: (your name here)   Status: stub. Switching it on is refused until the
 * registry in index.ts marks it "done".
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
 * Timing (handled for you): barsOf(benchmark) already includes the benchmark's bar
 * for this same minute, even though symbols are evaluated one at a time.
 * Both lists are today's regular-session bars only.
 *
 * Steps: 1) write your rule as a comment, 2) code it below, 3) make
 * src/tests/strategy/team3Reversal/relativeToSpy.test.ts describe your rule.
 */

import type { EntryFilter } from "./types";

export const relativeToSpyAllows: EntryFilter = (_input) => {
  // TODO: your rule. Until then every trade goes through (same as the baseline).
  return true;
};
