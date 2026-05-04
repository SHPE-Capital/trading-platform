/**
 * strategy.ts
 *
 * Types for strategy definitions, configuration, signals, and runtime state.
 * Strategies are pluggable modules; this file defines the shared contract.
 *
 * Inputs:  Normalized symbol/portfolio state, rolling windows, indicator results.
 * Outputs: StrategySignal or OrderIntent emitted to the execution pipeline.
 */

import type { UUID, EpochMs, Symbol, OrderSide, Metadata } from "./common";

// ------------------------------------------------------------------
// Strategy Type Registry
// ------------------------------------------------------------------

/**
 * Supported strategy types.
 * Add new types here when additional strategies are implemented.
 */
export type StrategyType =
  | "pairs_trading"
  | "momentum"
  | "arbitrage"
  | "market_making"
  | "neural_network";

/** Strategy lifecycle status */
export type StrategyRunStatus = "idle" | "running" | "paused" | "stopped" | "error";

// ------------------------------------------------------------------
// Base Strategy Config
// ------------------------------------------------------------------

/**
 * Shared configuration fields present in every strategy.
 * Strategy-specific config extends this via intersection or inheritance.
 */
export interface BaseStrategyConfig {
  /** Strategy instance ID (assigned at creation) */
  id: UUID;
  /** Human-readable name for this strategy instance */
  name: string;
  /** Strategy algorithm type */
  type: StrategyType;
  /** Symbols this strategy monitors/trades */
  symbols: Symbol[];
  /** Rolling window duration in milliseconds */
  rollingWindowMs: number;
  /** Maximum position size in USD notional */
  maxPositionSizeUsd: number;
  /** Cooldown period after any exit (ms) */
  cooldownMs: number;
  /** Whether the strategy is enabled */
  enabled: boolean;
  /** Optional description */
  description?: string;
  /** Optional custom metadata */
  meta?: Metadata;
}

// ------------------------------------------------------------------
// Signal Direction
// ------------------------------------------------------------------

/** Direction of a strategy signal */
export type SignalDirection = "long" | "short" | "flat" | "close_long" | "close_short";

// ------------------------------------------------------------------
// Strategy Signal
// ------------------------------------------------------------------

/**
 * A signal emitted by a strategy indicating a desired action.
 * The execution layer converts confirmed signals into OrderIntents.
 */
export interface StrategySignal {
  /** Unique signal ID */
  id: UUID;
  /** Strategy that generated this signal */
  strategyId: string;
  /** Strategy type for logging and routing */
  strategyType: StrategyType;
  /** Primary symbol for this signal */
  symbol: Symbol;
  /** Desired position direction */
  direction: SignalDirection;
  /**
   * Desired trade quantity (absolute value).
   * The execution layer applies side based on `direction`.
   */
  qty: number;
  /** Confidence score [0, 1] if applicable */
  confidence?: number;
  /** The metric/indicator value that triggered the signal */
  triggerValue?: number;
  /** Human-readable label for the trigger (e.g. "z_score_entry") */
  triggerLabel?: string;
  /** When the signal was generated (Unix ms) */
  ts: EpochMs;
  /** Optional signal metadata (e.g. hedge symbol, ratio) */
  meta?: Metadata;
}

// ------------------------------------------------------------------
// Strategy Runtime State
// ------------------------------------------------------------------

/** Snapshot of a strategy's current runtime state */
export interface StrategyRuntimeState {
  /** Strategy instance ID */
  id: UUID;
  /** Strategy type */
  type: StrategyType;
  /** Human-readable name */
  name: string;
  /** Lifecycle status */
  status: StrategyRunStatus;
  /** When this strategy run started */
  startedAt?: EpochMs;
  /** When this strategy run stopped */
  stoppedAt?: EpochMs;
  /** Number of signals generated this run */
  signalCount: number;
  /** Number of orders placed this run */
  orderCount: number;
  /** Realized PnL this run */
  realizedPnl: number;
  /** Last signal generated */
  lastSignal?: StrategySignal;
  /** Last error if status is "error" */
  lastError?: string;
  /** Strategy-specific state snapshot (serializable) */
  internalState?: Record<string, unknown>;
}

// ------------------------------------------------------------------
// Strategy Run Record (persisted)
// ------------------------------------------------------------------

/** A persisted record of a strategy execution run */
export interface StrategyRun {
  id: UUID;
  strategyId: UUID;
  strategyType: StrategyType;
  name: string;
  config: BaseStrategyConfig;
  status: StrategyRunStatus;
  executionMode: string;
  startedAt: EpochMs;
  stoppedAt?: EpochMs;
  totalSignals: number;
  totalOrders: number;
  realizedPnl: number;
  meta?: Metadata;
}

// ------------------------------------------------------------------
// Strategy Definition (strategies table)
// ------------------------------------------------------------------

/**
 * A stored strategy definition row from the `strategies` table.
 * version reflects the algorithm version at the time the config was created,
 * not an edit counter — see config/strategyDefaults.ts for the source.
 */
export interface Strategy {
  id: UUID;
  strategy_type: StrategyType;
  version: number;
  name: string;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
