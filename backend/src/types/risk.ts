/**
 * risk.ts
 *
 * Types for the risk management layer. Risk checks validate every
 * OrderIntent before it reaches the execution layer.
 *
 * Inputs:  OrderIntent, current PortfolioSnapshot, strategy config.
 * Outputs: RiskCheckResult indicating pass or reject with reason.
 */

import type { UUID, EpochMs } from "./common";
import type { OrderIntent } from "./orders";

// ------------------------------------------------------------------
// Risk Check Result
// ------------------------------------------------------------------

/** Result of running a risk check against an order intent */
export interface RiskCheckResult {
  /** Whether the order passed all risk checks */
  passed: boolean;
  /** The intent that was checked */
  intent: OrderIntent;
  /**
   * Which named check failed (if any).
   * e.g. "MAX_POSITION_SIZE", "MAX_NOTIONAL_EXPOSURE"
   */
  failedCheck?: string;
  /** Human-readable rejection reason */
  reason?: string;
  /** Timestamp of the check (Unix ms) */
  ts: EpochMs;
}

// ------------------------------------------------------------------
// Risk Config
// ------------------------------------------------------------------

/** Global risk parameters applied across all strategies */
export interface RiskConfig {
  /** Maximum allowed position size in USD notional per symbol */
  maxPositionSizeUsd: number;
  /** Maximum total notional exposure across all positions */
  maxNotionalExposureUsd: number;
  /**
   * Cooldown period in milliseconds after any order is placed.
   * Prevents immediate re-entry on the same strategy.
   */
  orderCooldownMs: number;
  /**
   * Maximum age of the latest quote before it is considered stale.
   * Orders will be rejected if quote data is older than this.
   */
  staleQuoteThresholdMs: number;
  /** Whether to allow short selling */
  allowShortSelling: boolean;
  /** Whether the kill switch is active (blocks all orders) */
  killSwitchActive: boolean;
  /** Maximum intraday drawdown as a fraction of start-of-day equity before kill switch engages */
  maxIntradayDrawdownPct?: number;
  /** Maximum concentration in any single symbol as a fraction of total equity */
  maxConcentrationPct?: number;
  /** Minimum cash reserve as a fraction of total equity — orders rejected if breached */
  cashReservePct?: number;
  /** Maximum gross exposure (sum of |positions|) as a fraction of equity */
  maxGrossExposurePct?: number;
  /** Maximum net exposure (|longs - shorts|) as a fraction of equity */
  maxNetExposurePct?: number;
  /** Gap risk buffer in basis points — applied adversely at signal time for market orders */
  gapBufferBps: number;
  /** Half-spread estimate in basis points — added to gap buffer for worst-case fill price */
  spreadBufferBps: number;
}

// ------------------------------------------------------------------
// Strategy Risk Budget
// ------------------------------------------------------------------

/** Per-strategy capital allocation limits registered with the risk engine */
export interface StrategyRiskBudget {
  strategyId: string;
  /** Max capital as a fraction of portfolio equity. e.g. 0.20 = 20%. */
  maxCapitalPct: number;
  /** Max single-order notional as a fraction of equity. e.g. 0.05 = 5%. */
  maxOrderNotionalPct?: number;
  /** Max simultaneous open orders from this strategy. */
  maxOpenOrders?: number;
}

// ------------------------------------------------------------------
// Portfolio Risk Violation
// ------------------------------------------------------------------

/** Result of a post-fill portfolio risk check */
export interface PortfolioRiskViolation {
  check: string;
  reason: string;
  engageKillSwitch: boolean;
  grossExposurePct?: number;
  netExposurePct?: number;
}

// ------------------------------------------------------------------
// Risk Event Log
// ------------------------------------------------------------------

/** A log entry recording a risk rejection */
export interface RiskRejectionLog {
  id: UUID;
  strategyId: string;
  intentId: UUID;
  failedCheck: string;
  reason: string;
  ts: EpochMs;
}
