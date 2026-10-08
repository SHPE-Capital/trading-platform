/**
 * core/backtest/strategyFactory.ts
 *
 * Builds the strategy instances a backtest config describes. Shared by the
 * queue worker and the CLI runner so both simulate exactly the same thing.
 */

import { PairsStrategy } from "../../strategies/pairs/pairsStrategy";
import { createPairsConfig } from "../../strategies/pairs/pairsConfig";
import type { BacktestConfig } from "../../types/backtest";
import type { IStrategy } from "../../strategies/base/strategy";

/** Strategy types the backtest engine can simulate. */
export const BACKTESTABLE_TYPES: ReadonlySet<string> = new Set(["pairs_trading"]);

export function buildBacktestStrategies(config: BacktestConfig): IStrategy[] {
  const sc = config.strategyConfig;
  if (sc.type === "pairs_trading") {
    const pairsConfig = createPairsConfig(sc.symbols[0], sc.symbols[1] ?? sc.symbols[0], sc as never);
    return [new PairsStrategy(pairsConfig)];
  }
  throw new Error(`Backtesting is not supported for strategy type "${sc.type}"`);
}
