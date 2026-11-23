/**
 * strategies/momentum/manifest.ts
 *
 * Catalog entry for the breakout momentum strategy. Experimental and hidden
 * until the weekly runtime pieces (P1-4, P1-5, P2-x) land; it has no generic
 * form because its parameters come from the weekly artifact.
 */

import type { StrategyManifest } from "../../config/strategyManifest";
import { asProblem } from "../../config/strategyManifest";
import { BreakoutMomentumStrategy } from "./breakoutMomentumStrategy";
import {
  DEFAULT_BREAKOUT_MOMENTUM_CONFIG,
  createBreakoutMomentumConfig,
  validateBreakoutMomentumConfig,
} from "./breakoutMomentumConfig";
import type { BreakoutMomentumConfig } from "./breakoutMomentumTypes";

const build = (config: Record<string, unknown>) =>
  createBreakoutMomentumConfig(config as Partial<BreakoutMomentumConfig>);

export const breakoutMomentumManifest: StrategyManifest = {
  type: "momentum",
  status: "experimental",
  hidden: true,
  label: "Breakout Momentum",
  description:
    "Minute-bar breakout with ADX, EMA trend, relative volume and VWAP confirmations; every parameter " +
    "comes from the weekly configuration artifact, and no artifact means no new entries.",
  version: BreakoutMomentumStrategy.VERSION,
  defaultConfig: { ...DEFAULT_BREAKOUT_MOMENTUM_CONFIG, symbols: [], name: "Breakout Momentum" },
  create: (config) => new BreakoutMomentumStrategy(build(config)),
  validate: (config) => asProblem(() => validateBreakoutMomentumConfig(build(config))),
};
