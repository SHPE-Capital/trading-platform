/**
 * strategies/team3Reversal/filters/index.ts
 *
 * The filter registry: which switch turns on which filter. The strategy runs
 * the entry filters in this order and stops at the first one that blocks.
 *
 * Owner: team lead.
 */

import type { Team3ReversalConfig } from "../team3ReversalConfig";
import type { EntryFilter, ExitRule } from "./types";
import { bigMoveAllows } from "./bigMove";
import { volumeAllows } from "./volume";
import { relativeToSpyAllows } from "./relativeToSpy";
import { timeOfDayAllows } from "./timeOfDay";
import { holdUntilBackShouldExit } from "./holdUntilBack";

type SwitchKey = "useBigMove" | "useVolume" | "useRelativeToSpy" | "useTimeOfDay";

export interface EntryFilterEntry {
  /** Short name used in logs and signal meta. */
  name: string;
  switchKey: SwitchKey;
  allows: EntryFilter;
}

export interface FilterSet {
  entry: readonly EntryFilterEntry[];
  exit: ExitRule;
}

export const TEAM3_FILTERS: FilterSet = {
  entry: [
    { name: "timeOfDay", switchKey: "useTimeOfDay", allows: timeOfDayAllows },
    { name: "bigMove", switchKey: "useBigMove", allows: bigMoveAllows },
    { name: "volume", switchKey: "useVolume", allows: volumeAllows },
    { name: "relativeToSpy", switchKey: "useRelativeToSpy", allows: relativeToSpyAllows },
  ],
  exit: holdUntilBackShouldExit,
};

/** Names of the entry filters switched on in this config, in run order. */
export function enabledEntryFilters(filters: FilterSet, config: Team3ReversalConfig): EntryFilterEntry[] {
  return filters.entry.filter((f) => config[f.switchKey]);
}
