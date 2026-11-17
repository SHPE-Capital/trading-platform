/**
 * strategies/team3Reversal/filters/timeOfDay.ts
 *
 * Filter: Skip the open and close.  Switch: useTimeOfDay  Knob: skipEdgeMinutes
 * Owner: (your name here)
 *
 * Idea in plain words: the first and last minutes of the day are the noisiest
 * and the most expensive to trade. Block the trade during the first
 * `skipEdgeMinutes` minutes after 9:30 ET and the last `skipEdgeMinutes`
 * minutes before 16:00 ET.
 *
 * Useful tools:
 *   - input.bar.ts: the bar's start time.
 *   - minutesSinceOpen, minutesUntilClose from "../session".
 *
 * Steps: 1) write your rule as a comment, 2) code it below, 3) make
 * src/tests/strategy/team3Reversal/timeOfDay.test.ts describe your rule.
 */

import type { EntryFilter } from "./types";

export const timeOfDayAllows: EntryFilter = (_input) => {
  // TODO: your rule. Until then every trade goes through (same as the baseline).
  return true;
};
