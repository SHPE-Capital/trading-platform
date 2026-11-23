/**
 * strategies/team3Reversal/filters/relativeToSpy.ts
 *
 * Filter: Relative to the market.  Switch: useRelativeToSpy  Knob: benchmarkSymbol
 * Owner: Alex Rivera (PR #78; rule below is his 1-minute version)   Status: stub. Switching it on is refused until the
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

export const relativeToSpyAllows: EntryFilter = ({ bar, move, side, barsOf, config }) => {
  const benchmarkBars = barsOf(config.benchmarkSymbol);
  const moveInFadeDirection = side === "sell" ? move : -move;

  for (let i = benchmarkBars.length - 1; i > 0; i--) {
    const benchmark = benchmarkBars[i];
    if (benchmark.ts > bar.ts) continue;
    if (benchmark.ts < bar.ts) break;

    const previous = benchmarkBars[i - 1];
    if (previous.ts !== bar.ts - 60_000 || previous.close <= 0) break;

    const benchmarkMove = (benchmark.close - previous.close) / previous.close;
    return moveInFadeDirection > 2 * Math.abs(benchmarkMove);
  }

  // Skip the entry when the benchmark's one-minute return is unavailable.
  return false;
};
