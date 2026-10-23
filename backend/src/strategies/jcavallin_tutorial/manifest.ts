// backend/src/strategies/jcavallinReversal/manifest.ts
import { config } from "dotenv";
import type { StrategyManifest } from "../../config/strategyManifest";
import { TutorialStrategy, type TutorialConfigConfig } from "./jcavallin__tutorial";

// Passed to manifest as the default strategy configuration
const DEFAULTS = {
  name: "Tutorial",
  type: "tutorial",
  symbols: ["SPY"],
  rollingWindowMs: 60_000,
  maxPositionSizeUsd: 10_000,
  cooldownMs: 0,
  enabled: true,
};

// Defines the parameters that can be passed to the strategy. Same in backend and displayed in the UI
// By default uses the values defined above in Defaults
export const TutorialManifest: StrategyManifest = {
    type: "tutorial",
    status : "experimental",
    label : "Tutorial Strategy",
    description : "Sell after the price in bar goes up, buy if the price of bar goes down.", // ?? what type of price from the bar does this use??
    version: TutorialStrategy.VERSION,
    defaultConfig: DEFAULTS,
    create (config) => new TutorialStrategy(...DEFAULTS, ...config as )



}