/**
 * strategies/team3Reversal/filters/holdUntilBack.ts
 *
 * Exit rule: Hold until it comes back.  Switch: useHoldUntilBack  Knob: holdMaxBars
 * Owner: (your name here)
 *
 * Idea in plain words: the baseline flips its position every minute and pays
 * costs every time. With this switch on, the strategy enters once and then
 * waits: it ignores new signals while it holds a position and asks this rule
 * every bar whether to close. Close when the price has come back to its
 * recent average, or when we've held for `holdMaxBars` bars, whichever is first.
 *
 * Useful tools:
 *   - input.bar.close, input.entryPrice, input.barsHeld, input.positionQty.
 *   - input.history (recent closes); computeMean or latestSMA from
 *     "../../../services/indicators".
 *
 * Steps: 1) write your rule as a comment, 2) code it below, 3) make
 * src/tests/strategy/team3Reversal/holdUntilBack.test.ts describe your rule.
 */

import type { ExitRule } from "./types";

export const holdUntilBackShouldExit: ExitRule = (_input) => {
  // TODO: your rule. Until then the position is closed on the very next bar.
  return true;
};
