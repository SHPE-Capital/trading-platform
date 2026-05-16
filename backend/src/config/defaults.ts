/**
 * config/defaults.ts
 *
 * Default runtime configuration values used when strategy or engine
 * configs are not explicitly overridden. These are safe starting values.
 */

import { env } from "./env";
import type { RiskConfig } from "../types/risk";

/** Default rolling window durations in milliseconds */
export const DEFAULT_WINDOWS = {
  /** Short-term window for microstructure signals */
  short: 10_000,
  /** Medium-term window for spread/z-score calculations */
  medium: 60_000,
  /** Long-term window for trend and volatility baselines */
  long: 300_000,
} as const;

/** Default risk configuration */
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxPositionSizeUsd: env.maxPositionSizeUsd,
  maxNotionalExposureUsd: env.maxNotionalExposureUsd,
  orderCooldownMs: env.orderCooldownMs,
  staleQuoteThresholdMs: 10_000,
  allowShortSelling: true,       // Required for pairs, stat-arb, and market-making strategies
  killSwitchActive: false,
  maxIntradayDrawdownPct: 0.05,  // 5% intraday drawdown limit — engages kill switch
  maxConcentrationPct: 0.30,     // 30% max concentration in any single symbol
  cashReservePct: 0.05,          // 5% cash buffer always kept in reserve
  gapBufferBps: 20,              // 0.20% gap risk buffer for market orders
  spreadBufferBps: 5,            // 0.05% half-spread estimate
};

/** Backtest risk configuration */
export const BACKTEST_RISK_CONFIG: RiskConfig = {
  ...DEFAULT_RISK_CONFIG,
  orderCooldownMs: 0, // Prevent blocking paired legs in backtest
};

/** Default heartbeat interval for the engine (ms) */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;

/** Default portfolio snapshot interval (ms) */
export const DEFAULT_SNAPSHOT_INTERVAL_MS = 60_000;

/** Default simulated fill delay for backtest/paper modes (ms) */
export const DEFAULT_SIMULATED_FILL_DELAY_MS = 100;

/** Default commission per share for backtesting */
export const DEFAULT_COMMISSION_PER_SHARE = 0.005;
