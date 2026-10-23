import type { StrategyManifest } from "../../config/strategyManifest";
import { McarrascoReversalStrategy, type ReversalConfig } from "./strategy";

const DEFAULTS = {
  name: "Mcarrasco Reversal",
  type: "mcarrasco_reversal",
  symbols: ["SPY"],
  rollingWindowMs: 60_000,
  maxPositionSizeUsd: 10_000,
  cooldownMs: 0,
  enabled: true,
  maxPositionQty: 1,
};

function createStrategy(config: Record<string, unknown>): McarrascoReversalStrategy {
  const mergedConfig = {
    ...DEFAULTS,
    ...config,
  };
  const strategyConfig = mergedConfig as ReversalConfig;
  const strategy = new McarrascoReversalStrategy(strategyConfig);
  return strategy;
}

export const mcarrascoReversalManifest: StrategyManifest = {
  type: "mcarrasco_reversal",
  status: "experimental",
  label: "Mcarrasco Reversal",
  description: "Sell after an up bar, buy after a down bar.",
  version: McarrascoReversalStrategy.VERSION,
  defaultConfig: DEFAULTS,
  create: createStrategy,
  params: [
    {
      key: "symbols",
      label: "Symbols",
      kind: "symbols",
    },
    {
      key: "maxPositionQty",
      label: "Max position (shares)",
      kind: "number",
      min: 1,
      step: 1,
      hint: "Largest absolute share position per symbol",
    },
  ],
};