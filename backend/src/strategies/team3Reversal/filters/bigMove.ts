/**
 * strategies/team3Reversal/filters/bigMove.ts
 *
 * Filter: Big moves only.        Switch: useBigMove        Knob: bigMoveMinZ
 * Owner: (your name here)
 *
 * Idea in plain words: small moves are mostly noise; a move much bigger than
 * normal is more likely a hurried trader who pushed the price too far. Only
 * let the trade through when this bar's move is at least `bigMoveMinZ`
 * standard deviations away from the average move of the recent bars.
 *
 * Useful tools:
 *   - input.move: this bar's move. input.history: the earlier bars.
 *   - computeMean, computeStdDev from "../../../services/indicators".
 *
 * Steps: 1) write your rule as a comment, 2) code it below, 3) make
 * src/tests/strategy/team3Reversal/bigMove.test.ts describe your rule.
 */

import type { EntryFilter } from "./types";

export const bigMoveAllows: EntryFilter = (_input) => {
  // TODO: your rule. Until then every trade goes through (same as the baseline).
  return true;
};
