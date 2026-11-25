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
 * Research windows (docs/team3/ablation.md header). IS = 32 trading days, OOS = 26 (end extended 11-13 -> 11-20, lead, 2026-11-23).
 * OOS is locked until Stage 3 (MASTER.md, Testing rules).
 */
export type Team3Window = "in" | "out" | "s4a" | "t1" | "t2" | "t3" | "t4";
export const TEAM3_WINDOWS: Record<Team3Window, { startDate: string; endDate: string }> = {
  in: { startDate: "2026-09-01T00:00:00Z", endDate: "2026-10-15T23:59:59Z" },
  out: { startDate: "2026-10-16T00:00:00Z", endDate: "2026-11-20T23:59:59Z" },
  // Stage 4 (ablation.md "Stage 4 pre-registration"). s4a = 4a out-of-universe: IS + OOS dates, unseen for the expanded stocks.
  s4a: { startDate: "2026-09-01T00:00:00Z", endDate: "2026-11-20T23:59:59Z" },
  // 4b out-of-time: the 12 months before in-sample, in quarters starting Sep / Dec / Mar / Jun.
  t1: { startDate: "2025-09-01T00:00:00Z", endDate: "2025-11-30T23:59:59Z" },
  t2: { startDate: "2025-12-01T00:00:00Z", endDate: "2026-02-28T23:59:59Z" },
  t3: { startDate: "2026-03-01T00:00:00Z", endDate: "2026-05-31T23:59:59Z" },
  t4: { startDate: "2026-06-01T00:00:00Z", endDate: "2026-08-31T23:59:59Z" },
};

/** Research universes (AGENT_GUIDE.md section 2). Momentum is the main universe, Core the control. */
/** OOS ban: true when a run ending at endDate would touch out-of-sample days without --stage3. */
export function oosLocked(endDate: string, stage3: boolean): boolean {
  return !stage3 && Date.parse(endDate) > Date.parse(TEAM3_WINDOWS.in.endDate);
}

export type Team3Group = "core" | "momentum" | "expanded";
export const TEAM3_GROUPS: Record<Team3Group, string[]> = {
  core: ["SPY", "QQQ", "AAPL", "MSFT", "GOOGL", "AMZN"],
  momentum: ["SPY", "NVDA", "AMD", "MU", "TSLA", "META"],
  /** Stage 4a out-of-universe: the 25 frozen in docs/team3/stage4/universe.json (commit e3dc1a3) + SPY benchmark. */
  expanded: [
    "SPY", "AVGO", "INTC", "ORCL", "PLTR", "AMAT", "GEV", "WDC", "LRCX", "HOOD", "STX", "CAT", "VRT", "GS",
    "COIN", "RKLB", "GE", "APP", "FCX", "ETN", "BA", "C", "FIX", "MS", "NEM", "RDDT",
  ],
};

/** The frozen Stage 2 baseline (VERSION 4 defaults, IS), one run per universe: A03 Core, A04 Momentum. */
export const TEAM3_BASELINES: Record<"core" | "momentum", string> = {
  core: "1872fd42-331a-4a8c-a488-460231ac8552",
  momentum: "4b060cbe-2834-4996-8b6b-c223bef772ed",
};

/**
 * Which universe a run's symbols belong to: a subset of exactly one group
 * (e.g. Core without SPY/QQQ is still Core). null if none or ambiguous (SPY alone).
 */
export function universeOf(symbols: readonly string[]): Team3Group | null {
  const fits = (Object.keys(TEAM3_GROUPS) as Team3Group[])
    .filter((g) => symbols.length > 0 && symbols.every((s) => TEAM3_GROUPS[g].includes(s)));
  return fits.length === 1 ? fits[0] : null;
}

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
