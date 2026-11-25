/**
 * strategies/team3Reversal/manifest.ts
 *
 * How the app shows Team 3 Reversal: its name, default settings, and the form
 * fields (baseline knobs and caps, one checkbox per filter switch, one number per knob).
 *
 * Released configuration: L2 (SPY-divergence entry, 150-bar hold), frozen at commit 2120a7c.
 * Only the form's pre-fill is L2; DEFAULT_TEAM3_REVERSAL_CONFIG stays the research baseline.
 * Strategy sheet: docs/strategies/team3-vwap-reversion.md
 *
 * Owner: team lead.
 */

import { asProblem, type StrategyManifest } from "../../config/strategyManifest";
import { Team3ReversalStrategy } from "./team3ReversalStrategy";
import {
  DEFAULT_TEAM3_REVERSAL_CONFIG,
  createTeam3ReversalConfig,
  validateTeam3ReversalConfig,
  type Team3ReversalConfig,
} from "./team3ReversalConfig";
import { TEAM3_GROUPS } from "./contract/protocol";

const build = (config: Record<string, unknown>) => createTeam3ReversalConfig(config as Partial<Team3ReversalConfig>);

export const team3ReversalManifest: StrategyManifest = {
  type: "team3_reversal",
  status: "ready",
  label: "Team 3 VWAP Reversion",
  description:
    "L2: intraday VWAP reversion on 1-minute bars. Enters when a stock is stretched from VWAP while SPY " +
    "is stretched the opposite way, exits back at VWAP, on a z stop or after 150 bars, flat by the close. " +
    "Frozen at commit 2120a7c.",
  version: Team3ReversalStrategy.VERSION,
  defaultConfig: {
    ...DEFAULT_TEAM3_REVERSAL_CONFIG,
    useSpyDivergence: true,
    maxHoldBars: 150,
    symbols: [...TEAM3_GROUPS.momentum],
    name: "Team 3 VWAP Reversion: SPY-Divergence, 150-bar hold (L2) v8",
  },
  // Saved configs may omit fields; createTeam3ReversalConfig fills them from the defaults.
  create: (config) => new Team3ReversalStrategy(build(config)),
  validate: (config) => asProblem(() => validateTeam3ReversalConfig(build(config))),
  params: [
    { key: "symbols", label: "Symbols", kind: "symbols", hint: "Comma-separated, e.g. SPY, QQQ, AAPL" },

    { key: "entryZ", label: "Entry: min VWAP z-score", kind: "number", min: 0, step: 0.1 },
    { key: "minEdgeBps", label: "Entry: min distance to VWAP (bps)", kind: "number", min: 0, step: 1, hint: "Should beat round-trip costs" },
    { key: "stopZ", label: "Exit: stop at VWAP z-score", kind: "number", min: 0, step: 0.1, hint: "Must be above entry z" },
    { key: "maxHoldBars", label: "Exit: max bars held", kind: "number", min: 1, step: 1 },
    { key: "skipOpenMinutes", label: "Session: no entries first N minutes", kind: "number", min: 0, step: 1 },
    { key: "lastEntryMinutesBeforeClose", label: "Session: no entries last N minutes", kind: "number", min: 0, step: 1 },
    { key: "flattenMinutesBeforeClose", label: "Session: flatten N minutes before close", kind: "number", min: 1, step: 1 },
    { key: "tradeUsd", label: "Size: $ per entry", kind: "number", min: 1, step: 100 },
    { key: "maxPositionSizeUsd", label: "Cap: $ per symbol", kind: "number", min: 1, step: 100 },
    { key: "maxGrossUsd", label: "Cap: $ gross (longs + shorts)", kind: "number", min: 1, step: 1000 },
    { key: "lookbackBars", label: "Bars of history for filters", kind: "number", min: 1, step: 1 },

    { key: "useVwapRegime", label: "Filter: choppy days only (VWAP crossings)", kind: "boolean" },
    { key: "minVwapCrossings", label: "VWAP regime: min crossings", kind: "number", min: 1, step: 1 },
    { key: "vwapWindowBars", label: "VWAP regime: window (bars)", kind: "number", min: 2, step: 1 },
    { key: "useVolume", label: "Filter: skip high-volume moves (stub)", kind: "boolean" },
    { key: "volumeMaxRatio", label: "Volume: max ratio to average", kind: "number", min: 0, step: 0.1 },
    { key: "useRelativeToSpy", label: "Filter: relative to the market (stub)", kind: "boolean" },
    { key: "benchmarkSymbol", label: "Relative: benchmark symbol", kind: "text", hint: "Must also be in Symbols" },
    { key: "useVolSizing", label: "Sizing: volatility target", kind: "boolean" },
    { key: "useCostGate", label: "Filter: edge x capture share beats costs", kind: "boolean" },
    { key: "captureShare", label: "Cost gate: capture share (0-1]", kind: "number", min: 0.05, step: 0.05 },
    { key: "costFixedBps", label: "Cost gate: fixed round trip (bps)", kind: "number", min: 0, step: 0.5 },
    { key: "costCommissionPerShare", label: "Cost gate: commission per share ($)", kind: "number", min: 0, step: 0.001 },
    // ==== Stage 2 per-goal blocks (params): each session adds lines ONLY between its own markers ====
    // ---- R1 (team3/r1) ----
    { key: "useTurnEntry", label: "Entry: wait for the turn back toward VWAP", kind: "boolean" },
    // ---- end R1 ----
    // ---- R2 (team3/r2) ----
    // ---- end R2 ----
    // ---- R4 (team3/r4) ----
    { key: "usePartwayTarget", label: "Exit: partway target (R4)", kind: "boolean" },
    { key: "useScaleOut", label: "Exit: scale out half at the partway point (R4)", kind: "boolean" },
    { key: "tpFraction", label: "Partway target: fraction of entry z (0-1]", kind: "number", min: 0.05, step: 0.05 },
    // ---- end R4 ----
    // ---- R5 (team3/r5) ----
    { key: "useCrowdSplit", label: "Sizing: split size across same-way stretched symbols", kind: "boolean" },
    // ---- end R5 ----
    // ---- RSPY (team3/rspy) ----
    { key: "rtsMinOwnShare", label: "Relative to SPY: min own share of move (0-1)", kind: "number", min: 0, step: 0.05 },
    // ---- end RSPY ----
    // ---- S5 ----
    { key: "useSpyDivergence", label: "Entry: stock stretched while SPY stretched the other way (S5)", kind: "boolean" },
    { key: "useOwnQuietEntry", label: "Entry: stock-specific stretch on a quiet day (S5)", kind: "boolean" },
    { key: "useConditionEntry", label: "Entry: survey condition set (F3-F5; conditions via config JSON)", kind: "boolean" },
    // ---- end S5 ----
    { key: "riskPerTradeUsd", label: "Vol sizing: $ risk per 1-min move", kind: "number", min: 1, step: 1 },
  ],
};
