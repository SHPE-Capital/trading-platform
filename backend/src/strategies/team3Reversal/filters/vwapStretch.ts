/**
 * strategies/team3Reversal/filters/vwapStretch.ts
 *
 * Filter: Stretched from VWAP.   Switch: useVwapStretch   Knob: minVwapZ
 *
 * Idea in plain words: a bar that pushes price far away from VWAP is a
 * temporary order imbalance, and those tend to snap back toward VWAP. Only let
 * the fade through when it points back toward VWAP from far enough away:
 *   - sell (after an up bar) only if the close is >= minVwapZ sigmas ABOVE VWAP
 *   - buy (after a down bar) only if the close is >= minVwapZ sigmas BELOW VWAP
 *
 * No VWAP or zero spread yet (z is null) = block.
 *
 * Source idea: VWAP deviations as temporary imbalances (SSRN 6438039).
 * Docs: docs/team3/components/vwap-stretch.md
 */

import type { EntryFilter } from "./types";

export const vwapStretchAllows: EntryFilter = ({ vwap, side, config }) => {
  if (!vwap || vwap.z === null) return false;
  return side === "sell" ? vwap.z >= config.minVwapZ : vwap.z <= -config.minVwapZ;
};
