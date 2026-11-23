/**
 * strategies/team3Reversal/contract/protocol.ts
 *
 * The engine settings every Team 3 research backtest runs under. They belong to
 * the platform (not the strategy config), so they live here once, and
 * docs/team3/AGENT_GUIDE.md section 2 points here.
 *
 * Why the risk config is spelled out instead of using the platform default:
 *   - maxIntradayDrawdownPct: the platform measures it from the run's starting
 *     equity and never resets it, so on $100k it trips at -$5,000, closes
 *     everything and stops the run. 1 = off. (UPSTREAM.md #1)
 *   - per-symbol / gross caps default to .env values; fixing them here makes
 *     results independent of whoever's .env ran them, and sets them ABOVE the
 *     strategy's own caps so the engine never silently rejects a Team 3 order.
 *
 * Changing anything here changes every result: rerun every ablation row.
 * Owner: team lead.
 */

import type { BacktestConfig } from "../../../types/backtest";
import type { RiskConfig } from "../../../types/risk";
import type { BaseStrategyConfig } from "../../../types/strategy";
import { newId } from "../../../utils/ids";

export const TEAM3_PROTOCOL = {
  initialCapital: 100_000,
  dataGranularity: "bar" as const,
  /** Fill model: platform default (next bar's open, + half spread 2 bps), with these costs. */
  slippageBps: 5,
  commissionPerShare: 0.005,
  riskConfig: {
    maxIntradayDrawdownPct: 1,
    maxPositionSizeUsd: 15_000,
    maxNotionalExposureUsd: 60_000,
    maxConcentrationPct: 0.3,
    orderCooldownMs: 0,
    allowShortSelling: true,
    killSwitchActive: false,
  } satisfies Partial<RiskConfig>,
};

/**
 * Research windows (docs/team3/ablation.md header). IS = 32 trading days, OOS = 21.
 * OOS is locked until Stage 3 (MASTER.md, Testing rules).
 */
export const TEAM3_WINDOWS: Record<"in" | "out", { startDate: string; endDate: string }> = {
  in: { startDate: "2026-09-01T00:00:00Z", endDate: "2026-10-15T23:59:59Z" },
  out: { startDate: "2026-10-16T00:00:00Z", endDate: "2026-11-13T23:59:59Z" },
};

/** A BacktestConfig for a Team 3 run under the protocol. */
export function protocolBacktestConfig(
  strategyConfig: BaseStrategyConfig, window: { startDate: string; endDate: string }, strategyVersion?: number,
): BacktestConfig {
  const { riskConfig, ...engine } = TEAM3_PROTOCOL;
  return {
    id: newId(),
    name: `${strategyConfig.name} (Team 3 protocol)`,
    strategyConfig,
    ...(strategyVersion !== undefined ? { strategyVersion } : {}),
    ...window,
    ...engine,
    riskConfig: { ...riskConfig },
  };
}
