/**
 * core/backtest/strategyFactory.ts
 *
 * Builds the strategy instances a backtest config describes. Shared by the
 * queue worker and the CLI runner so both simulate exactly the same thing.
 */

import { STRATEGY_DEFINITIONS, STRATEGY_FACTORY, configProblem } from "../../config/strategyDefaults";
import type { BacktestConfig } from "../../types/backtest";
import type { IStrategy } from "../../strategies/base/strategy";

/** Strategy types the backtest engine can simulate. */
export const BACKTESTABLE_TYPES: ReadonlySet<string> = new Set(
  Object.values(STRATEGY_DEFINITIONS).filter((def) => def.backtestable !== false).map((def) => def.type),
);

export function buildBacktestStrategies(config: BacktestConfig): IStrategy[] {
  const sc = config.strategyConfig;
  if (!BACKTESTABLE_TYPES.has(sc.type)) {
    throw new Error(`Backtesting is not supported for strategy type "${sc.type}"`);
  }
  const problem = configProblem(sc.type, sc as unknown as Record<string, unknown>);
  if (problem) throw new Error(`Invalid configuration: ${problem}`);
  return [STRATEGY_FACTORY[sc.type](sc as unknown as Record<string, unknown>)];
}
