/**
 * portfolio.ts
 *
 * Types for portfolio management: positions, PnL, equity, and snapshots.
 * The portfolio state is maintained in-memory and periodically persisted.
 *
 * Inputs:  Fill events and order updates from the execution layer.
 * Outputs: Portfolio snapshots exposed to frontend APIs and persisted to DB.
 */

import type { UUID, EpochMs, ISOTimestamp, Symbol, Metadata } from "./common";

// ------------------------------------------------------------------
// Position
// ------------------------------------------------------------------

/** A current open position for a single symbol */
export interface Position {
  /** Position ID */
  id: UUID;
  /** Instrument held */
  symbol: Symbol;
  /**
   * Net quantity held. Positive = long, negative = short.
   * For the initial version, long-only positions are assumed.
   */
  qty: number;
  /** Average entry price across all fills building this position */
  avgEntryPrice: number;
  /** Current market price (latest mid or last trade) */
  currentPrice: number;
  /** Market value: qty × currentPrice */
  marketValue: number;
  /** Unrealized PnL: (currentPrice - avgEntryPrice) × qty */
  unrealizedPnl: number;
  /** Unrealized PnL as a percentage of cost basis */
  unrealizedPnlPct: number;
  /** Total realized PnL from closed trades on this symbol */
  realizedPnl: number;
  /** Cost basis: qty × avgEntryPrice */
  costBasis: number;
  /** When this position was first opened (Unix ms) */
  openedAt: EpochMs;
  /** When this position was last updated (Unix ms) */
  updatedAt: EpochMs;
  /** Strategy that opened this position */
  strategyId?: string;
}

// ------------------------------------------------------------------
// Portfolio Snapshot
// ------------------------------------------------------------------

/**
 * A point-in-time snapshot of the full portfolio state.
 * Stored periodically for charting the equity curve.
 */
export interface PortfolioSnapshot {
  /** Snapshot ID */
  id: UUID;
  /** When this snapshot was taken (Unix ms) */
  ts: EpochMs;
  /** ISO 8601 timestamp */
  isoTs: ISOTimestamp;
  /** Cash balance */
  cash: number;
  /** Total market value of all open positions */
  positionsValue: number;
  /** Total equity: cash + positionsValue */
  equity: number;
  /** Initial capital (used for return calculations) */
  initialCapital: number;
  /** Total unrealized PnL across all open positions */
  totalUnrealizedPnl: number;
  /** Total realized PnL since inception */
  totalRealizedPnl: number;
  /** Combined PnL: unrealized + realized */
  totalPnl: number;
  /** Return as a fraction: totalPnl / initialCapital */
  returnPct: number;
  /** All open positions at snapshot time */
  positions: Position[];
  /** Number of open positions */
  positionCount: number;
  /** Optional strategy-level breakdowns */
  strategyBreakdowns?: StrategyPnlBreakdown[];
}

// ------------------------------------------------------------------
// Strategy PnL Breakdown
// ------------------------------------------------------------------

/** PnL contribution from a single strategy within a portfolio snapshot */
export interface StrategyPnlBreakdown {
  strategyId: string;
  strategyType: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  positionCount: number;
}

// ------------------------------------------------------------------
// Performance Metrics
// ------------------------------------------------------------------

/**
 * Aggregate performance metrics computed over a run or backtest period.
 * These are stored after a backtest or strategy run completes.
 */
export interface PerformanceMetrics {
  /** Total return as a fraction */
  totalReturn: number;
  /** Total return as a percentage */
  totalReturnPct: number;
  /** Maximum drawdown as a fraction */
  maxDrawdown: number;
  /** Sharpe ratio (annualized) */
  sharpeRatio?: number;
  /** Sortino ratio (annualized) */
  sortinoRatio?: number;
  /** Calmar ratio */
  calmarRatio?: number;
  /** Win rate: winning trades / total trades */
  winRate: number;
  /** Total number of completed round-trip trades */
  totalTrades: number;
  /** Average profit per winning trade */
  avgWin: number;
  /** Average loss per losing trade */
  avgLoss: number;
  /** Profit factor: gross profit / gross loss */
  profitFactor?: number;
  /** Period start (Unix ms) */
  periodStart: EpochMs;
  /** Period end (Unix ms) */
  periodEnd: EpochMs;
  /** Optional extra data */
  meta?: Metadata;
}
