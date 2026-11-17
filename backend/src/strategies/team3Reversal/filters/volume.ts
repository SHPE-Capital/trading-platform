/**
 * strategies/team3Reversal/filters/volume.ts
 *
 * Filter: Skip high-volume moves.   Switch: useVolume   Knob: volumeMaxRatio
 * Owner: (your name here)
 *
 * Idea in plain words: a move on very high volume is more often news, and
 * news moves tend to keep going instead of coming back. Block the trade when
 * this bar's volume is more than `volumeMaxRatio` times the average volume of
 * the recent bars.
 *
 * Useful tools:
 *   - input.bar.volume: this bar's volume. input.history: the earlier bars.
 *   - computeMean from "../../../services/indicators".
 *
 * Steps: 1) write your rule as a comment, 2) code it below, 3) make
 * src/tests/strategy/team3Reversal/volume.test.ts describe your rule.
 */

import type { EntryFilter } from "./types";

export const volumeAllows: EntryFilter = (_input) => {
  // TODO: your rule. Until then every trade goes through (same as the baseline).
  return true;
};
