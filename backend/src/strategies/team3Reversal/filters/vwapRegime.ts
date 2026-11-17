/**
 * strategies/team3Reversal/filters/vwapRegime.ts
 *
 * Filter: Choppy days only.   Switch: useVwapRegime   Knobs: minVwapCrossings, vwapWindowBars
 *
 * Idea in plain words: fading works when price keeps swinging back and forth
 * across VWAP (a "rotational" day). On a trend day price stays on one side of
 * VWAP for hours and every fade loses. So count how many times the close
 * switched sides of VWAP over the last `vwapWindowBars` bars, and only let the
 * trade through when it switched at least `minVwapCrossings` times.
 *
 * No VWAP yet (no volume traded this session) = block. Early in the day there
 * are few crossings, so this filter also acts as a warm-up period.
 *
 * Source idea: VWAP-deviation regime classification (SSRN 6438039), rules only, no ML.
 * Docs: docs/team3/components/vwap-regime.md
 */

import type { EntryFilter } from "./types";

export const vwapRegimeAllows: EntryFilter = ({ vwap, config }) => {
  if (!vwap) return false;
  return vwap.crossings >= config.minVwapCrossings;
};
