/**
 * backtest.ts
 *
 * Types for backtest configuration, execution, and result storage.
 * Backtest mode reuses the same engine pipeline with a historical data source
 * and a simulated execution sink.
 *
 * Inputs:  BacktestConfig supplied by frontend or CLI.
 * Outputs: BacktestResult with equity curve, fills, and performance metrics.
 */

import type { UUID, EpochMs, ISOTimestamp, Metadata } from "./common";
import type { BaseStrategyConfig } from "./strategy";
import type { PortfolioSnapshot, PerformanceMetrics } from "./portfolio";
import type { Order, Fill } from "./orders";
import type { FillModelConfig } from "../core/execution/fillModel";
import type { ValidationIssue, ValidationMetadata } from "../core/backtest/dataValidation";
import type { RiskConfig } from "./risk";

// ------------------------------------------------------------------
// Backtest Config
// ------------------------------------------------------------------

/** Configuration for a single backtest run */
export interface BacktestConfig {
  /** Unique backtest run ID */
  id: UUID;
  /** Human-readable name */
  name: string;
  /** Strategy config to test (must be a complete config object) */
  strategyConfig: BaseStrategyConfig;
  /** Backtest period start (ISO 8601) */
  startDate: ISOTimestamp;
  /** Backtest period end (ISO 8601) */
  endDate: ISOTimestamp;
  /** Starting cash balance */
  initialCapital: number;
  /**
   * Data granularity used as primary event source.
   * "bar" is the most common; "quote" is higher fidelity but slower.
   */
  dataGranularity: "bar" | "quote" | "trade";
  /**
   * Simulated fill slippage in basis points.
   * Applied to the fill price relative to the bar close or quote mid.
   */
  slippageBps: number;
  /** Simulated commission per share */
  commissionPerShare: number;
  /** Set when the user picked a saved strategy; written to backtest_results.strategy_id */
  strategyId?: UUID;
  /** Algorithm version of the saved strategy at run time */
  strategyVersion?: number;
  /** Optional description */
  description?: string;
  /**
   * Optional fill model override. When omitted, the engine uses
   * DEFAULT_FILL_MODEL merged with the top-level `slippageBps` /
   * `commissionPerShare` fields so existing configs keep working.
   */
  fillModel?: Partial<FillModelConfig>;
  /**
   * Annualized risk-free rate used by Sharpe/Sortino. Default: 0.
   */
  riskFreeRateAnnual?: number;
  /**
   * Optional benchmark equity/return series (chronologically ordered).
   * The engine does NOT fetch benchmark data — supply it explicitly. When
   * omitted, benchmark fields in the result are left undefined.
   */
  benchmarkCurve?: { ts: EpochMs; value: number }[];
  /**
   * When true, abort the run if data validation reports any error-severity
   * issue. When false (default) the engine drops the offending bars and
   * surfaces a warning in the result.
   */
  strictDataValidation?: boolean;
  /**
   * Risk configuration override for this run. Merged with BACKTEST_RISK_CONFIG.
   * Included in the deduplication fingerprint so runs with different risk limits
   * are never treated as identical.
   */
  riskConfig?: Partial<RiskConfig>;
  /** Optional extra config */
  meta?: Metadata;
}

// ------------------------------------------------------------------
// Backtest Result
// ------------------------------------------------------------------>

/** Status of a backtest run */
export type BacktestStatus = "pending" | "running" | "completed" | "failed";

/** Full result of a completed backtest run */
export interface BacktestResult {
  /** Matches BacktestConfig.id */
  id: UUID;
  /** Configuration used */
  config: BacktestConfig;
  /** Run status */
  status: BacktestStatus;
  /** When the backtest run started (wall-clock Unix ms) */
  started_at: EpochMs;
  /** When the backtest run completed (wall-clock Unix ms) */
  completed_at?: EpochMs;
  /** Error message if status is "failed" */
  error_message?: string;
  /** Final portfolio state at end of backtest */
  final_portfolio: PortfolioSnapshot;
  /** Computed performance metrics */
  metrics: PerformanceMetrics;
  /**
   * Equity curve: one PortfolioSnapshot per bar/event period.
   * Used to draw the equity curve chart in the frontend.
   */
  equity_curve: PortfolioSnapshot[];
  /** All orders placed during the backtest */
  orders: Order[];
  /** All fills during the backtest */
  fills: Fill[];
  /** Number of events processed */
  event_count: number;
  /**
   * Set when this result was served from a previous identical run.
   * Contains the original backtest_results.id that was reused.
   */
  reused_from_id?: string;
  /**
   * Data validation issues and counts collected before the run started.
   * Useful for downstream visibility into excluded bars and gap warnings.
   */
  data_validation?: {
    issues: ValidationIssue[];
    metadata: ValidationMetadata;
  };
  /**
   * Fill model that was effectively in use for this run (after applying
   * defaults and config overrides). Consumers can inspect this to know
   * exactly which assumptions produced the fills/equity curve.
   */
  fill_model?: FillModelConfig;
  /**
   * Analytics availability and assumptions. Mirrors fields populated on
   * PerformanceMetrics but also includes which ratios were skipped due to
   * insufficient data.
   */
  assumptions?: {
    /** Number of return periods that fed into ratio computations. */
    periodCount: number;
    /** True if Sharpe/Sortino/Calmar were skipped due to short series. */
    insufficientReturnsForRatios: boolean;
    /** Whether the benchmark was supplied. */
    benchmarkProvided: boolean;
    /** Risk-free rate used. */
    riskFreeRateAnnual: number;
  };
}
