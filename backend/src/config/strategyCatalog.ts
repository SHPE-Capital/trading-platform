/**
 * config/strategyCatalog.ts
 *
 * Every strategy the platform knows about. To add one: write its folder under
 * strategies/, export a StrategyManifest from it, and add that manifest below.
 * Its `status` then decides whether it can be launched (see strategyManifest.ts).
 *
 * Pairs trading and minute reversal are declared inline: their folders are
 * covered by the strategy-version CI check, so a manifest file inside them
 * would force a VERSION bump for no behaviour change.
 */

import { mcarrascoReversalManifest } from "../strategies/mcarrasco_reversal/manifest";
import { DEFAULT_PAIRS_CONFIG, createPairsConfig, validatePairsConfig } from "../strategies/pairs/pairsConfig";
import { PairsStrategy } from "../strategies/pairs/pairsStrategy";
import type { PairsStrategyConfig } from "../strategies/pairs/pairsTypes";
import { MinuteReversalStrategy } from "../strategies/minuteReversal/minuteReversalStrategy";
import {
  createMinuteReversalConfig,
  validateMinuteReversalConfig,
  DEFAULT_MINUTE_REVERSAL_CONFIG,
  DEFAULT_MINUTE_REVERSAL_SYMBOLS,
} from "../strategies/minuteReversal/minuteReversalConfig";
import type { MinuteReversalConfig } from "../strategies/minuteReversal/minuteReversalTypes";
import { beginnerReversalManifest } from "../strategies/beginnerReversal/manifest";
import { asProblem, type StrategyManifest } from "./strategyManifest";


const pairsManifest: StrategyManifest = {
  type: "pairs_trading",
  status: "ready",
  label: "Pairs Trading",
  description:
    "Statistical arbitrage between two correlated instruments using z-score mean reversion.",
  version: PairsStrategy.VERSION,
  defaultConfig: {
    ...DEFAULT_PAIRS_CONFIG,
    leg1Symbol: "SPY",
    leg2Symbol: "QQQ",
    symbols: ["SPY", "QQQ"],
    name: "Pairs: SPY/QQQ",
  },
  create: (config) => {
    const symbols = config.symbols as string[] | undefined;
    return new PairsStrategy(createPairsConfig(
      (config.leg1Symbol as string) ?? symbols?.[0] ?? "SPY",
      (config.leg2Symbol as string) ?? symbols?.[1] ?? "QQQ",
      config as Partial<PairsStrategyConfig>,
    ));
  },
  // The max-hold limit is enforced by the strategy, so a value that would disable it is
  // reported at save time instead of only when the run starts.
  validate: (config) =>
    asProblem(() => validatePairsConfig(createPairsConfig(
      (config.leg1Symbol as string) ?? (config.symbols as string[] | undefined)?.[0] ?? "SPY",
      (config.leg2Symbol as string) ?? (config.symbols as string[] | undefined)?.[1] ?? "QQQ",
      config as Partial<PairsStrategyConfig>,
    ))),
  // No `params`: pairs trading has its own form in the frontend.
};

const minuteReversalManifest: StrategyManifest = {
  type: "minute_reversal",
  status: "ready",
  label: "Minute Reversal (test)",
  description:
    "Order-path test: sells a symbol after its 1-minute bar closes up and buys after it closes down, " +
    "one fixed share size per bar with a per-symbol position cap.",
  version: MinuteReversalStrategy.VERSION,
  defaultConfig: {
    ...DEFAULT_MINUTE_REVERSAL_CONFIG,
    symbols: [...DEFAULT_MINUTE_REVERSAL_SYMBOLS],
    name: "Minute Reversal: large caps",
  },
  // Saved configs may omit tuning fields; fill them from the defaults.
  create: (config) =>
    new MinuteReversalStrategy(createMinuteReversalConfig(config as Partial<MinuteReversalConfig>)),
  // The strategy's own check, run at save time instead of only at start.
  validate: (config) =>
    asProblem(() => validateMinuteReversalConfig(createMinuteReversalConfig(config as Partial<MinuteReversalConfig>))),
  // No `params`: it is not offered in the frontend picker.
};

export const STRATEGY_CATALOG: readonly StrategyManifest[] = [
  pairsManifest,
  minuteReversalManifest,
  beginnerReversalManifest,
  mcarrascoReversalManifest,
];

const seen = new Set<string>();
for (const manifest of STRATEGY_CATALOG) {
  if (seen.has(manifest.type)) throw new Error(`strategyCatalog: duplicate strategy type "${manifest.type}"`);
  seen.add(manifest.type);
}
