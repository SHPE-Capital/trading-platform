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
