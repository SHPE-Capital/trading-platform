/**
 * strategies/team3Reversal/manifest.ts
 *
 * How the app shows Team 3 Reversal: its name, default settings, and the form
 * fields (one checkbox per filter switch, one number per knob).
 *
 * Owner: team lead.
 */

import { asProblem, type StrategyManifest } from "../../config/strategyManifest";
import { Team3ReversalStrategy } from "./team3ReversalStrategy";
import {
  DEFAULT_TEAM3_REVERSAL_CONFIG,
  DEFAULT_TEAM3_REVERSAL_SYMBOLS,
  createTeam3ReversalConfig,
  validateTeam3ReversalConfig,
  type Team3ReversalConfig,
} from "./team3ReversalConfig";

const build = (config: Record<string, unknown>) => createTeam3ReversalConfig(config as Partial<Team3ReversalConfig>);

export const team3ReversalManifest: StrategyManifest = {
  type: "team3_reversal",
  status: "experimental",
  label: "Team 3 Reversal",
  description:
    "Fades regular-session 1-minute bars (sell after up, buy after down). Each filter is a switch; " +
    "with every switch off it is the baseline.",
  version: Team3ReversalStrategy.VERSION,
  defaultConfig: {
    ...DEFAULT_TEAM3_REVERSAL_CONFIG,
    symbols: [...DEFAULT_TEAM3_REVERSAL_SYMBOLS],
    name: "Team 3 Reversal: baseline",
  },
  // Saved configs may omit fields; createTeam3ReversalConfig fills them from the defaults.
  create: (config) => new Team3ReversalStrategy(build(config)),
  validate: (config) => asProblem(() => validateTeam3ReversalConfig(build(config))),
  params: [
    { key: "symbols", label: "Symbols", kind: "symbols", hint: "Comma-separated, e.g. SPY, QQQ, AAPL" },
    { key: "qtyPerTrade", label: "Shares per trade", kind: "number", min: 1, step: 1 },
    { key: "maxPositionQty", label: "Max position (shares)", kind: "number", min: 1, step: 1 },
    { key: "lookbackBars", label: "Bars of history for filters", kind: "number", min: 1, step: 1 },
    { key: "regularHoursOnly", label: "Regular session only (9:30-16:00 ET)", kind: "boolean" },

    { key: "useBigMove", label: "Filter: big moves only", kind: "boolean" },
    { key: "bigMoveMinZ", label: "Big move: minimum z-score", kind: "number", min: 0, step: 0.1 },
    { key: "useVolume", label: "Filter: skip high-volume moves", kind: "boolean" },
    { key: "volumeMaxRatio", label: "Volume: max ratio to average", kind: "number", min: 0, step: 0.1 },
    { key: "useRelativeToSpy", label: "Filter: relative to the market", kind: "boolean" },
    { key: "benchmarkSymbol", label: "Relative: benchmark symbol", kind: "text", hint: "Must also be in Symbols" },
    { key: "useTimeOfDay", label: "Filter: skip the open and close", kind: "boolean" },
    { key: "skipEdgeMinutes", label: "Time of day: minutes to skip at each end", kind: "number", min: 0, step: 1 },
    { key: "useHoldUntilBack", label: "Exit: hold until it comes back", kind: "boolean" },
    { key: "holdMaxBars", label: "Hold: max bars", kind: "number", min: 1, step: 1 },
  ],
};
