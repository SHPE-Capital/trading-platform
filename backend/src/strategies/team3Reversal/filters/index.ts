/**
 * strategies/team3Reversal/filters/index.ts
 *
 * The filter registry: which switch turns on which entry filter, and whether the
 * filter is finished. The strategy runs switched-on filters in this order and
 * stops at the first one that blocks.
 *
 * status "stub": the rule is not written yet. Config validation refuses to
 * switch a stub on, so no backtest can quietly run the baseline under a
 * filter's name. Set it to "done" in the same change that writes the rule.
 *
 * Owner: team lead.
 */

import type { Team3ReversalConfig } from "../team3ReversalConfig";
import type { EntryFilter, EntryInput } from "./types";
import { vwapRegimeAllows } from "./vwapRegime";
import { volumeAllows } from "./volume";
import { relativeToSpyAllows } from "./relativeToSpy";

export type SwitchKey = "useVwapRegime" | "useVolume" | "useRelativeToSpy";

export interface EntryFilterEntry {
  /** Short name used in logs and signal meta. */
  name: string;
  switchKey: SwitchKey;
  status: "done" | "stub";
  allows: EntryFilter;
}

export interface FilterSet {
  entry: readonly EntryFilterEntry[];
}

export const TEAM3_FILTERS: FilterSet = {
  entry: [
    { name: "vwapRegime", switchKey: "useVwapRegime", status: "done", allows: vwapRegimeAllows },
    { name: "volume", switchKey: "useVolume", status: "stub", allows: volumeAllows },
    { name: "relativeToSpy", switchKey: "useRelativeToSpy", status: "done", allows: relativeToSpyAllows },
  ],
};

/** The entry filters switched on in this config, in run order. */
export function enabledEntryFilters(filters: FilterSet, config: Team3ReversalConfig): EntryFilterEntry[] {
  return filters.entry.filter((f) => config[f.switchKey]);
}

/** Name of the first switched-on filter that blocks this trade, or null if all allow it. */
export function firstBlocking(active: readonly EntryFilterEntry[], input: EntryInput): string | null {
  return active.find((f) => !f.allows(input))?.name ?? null;
}
