/**
 * db/schema/tables.ts
 *
 * TypeScript-level documentation of all database table schemas.
 * These mirror the SQL migration definitions and serve as the source
 * of truth for column shapes expected when reading/writing rows.
 *
 * Inputs:  N/A — schema documentation only.
 * Outputs: N/A — schema documentation only.
 *
 * See db/migrations/001_initial.sql for the actual DDL statements.
 */

/**
 * Table: instruments
 * Stores metadata for all financial instruments tracked by the platform.
 */
export interface InstrumentsRow {
  id: string;              // UUID primary key
  symbol: string;          // Ticker symbol (UNIQUE, NOT NULL)
  name: string;            // Full company or ETF name
  asset_class: string;     // "us_equity" | "crypto" | "option"
  exchange: string | null; // Primary exchange (e.g. "NASDAQ")
  is_active: boolean;      // Whether this instrument is currently tradable
  created_at: string;      // ISO timestamp
}

/**
 * Table: strategies
 * Named, reusable strategy definitions. Each row is a saved config that
 * can be launched into one or more strategy_runs.
 */
export interface StrategiesRow {
  id: string;            // UUID primary key
  strategy_type: string; // "pairs_trading" | "momentum" | "arbitrage" | "market_making" | "neural_network"
  name: string;          // Human-readable label
  config: object;        // Full strategy config (BaseStrategyConfig shape)
  created_at: string;    // ISO timestamp
}

/**
 * Table: strategy_runs
 * Records every strategy execution instance (live, backtest, or replay).
 */
export interface StrategyRunsRow {
  id: string;
  strategy_id: string;      // Logical strategy definition ID
  strategy_type: string;    // "pairs_trading" | "momentum" | etc.
  name: string;
  config: object;           // Full JSON config snapshot
  status: string;           // "idle" | "running" | "stopped" | "error"
  execution_mode: string;   // "live" | "paper" | "backtest" | "replay"
  started_at: string | null;
  stopped_at: string | null;
  total_signals: number;
  total_orders: number;
  realized_pnl: number;
  meta: object | null;
  created_at: string;
}

/**
 * Table: orders
 * Full order lifecycle records.
 */
export interface OrdersRow {
  id: string;               // Internal order UUID
  broker_order_id: string | null;
  intent_id: string;
  strategy_id: string;
  symbol: string;
  side: string;             // "buy" | "sell"
  qty: number;
  filled_qty: number;
  avg_fill_price: number | null;
  order_type: string;
  limit_price: number | null;
  stop_price: number | null;
  time_in_force: string;
  status: string;
  submitted_at: string;
  updated_at: string;
  closed_at: string | null;
  meta: object | null;
}

/**
 * Table: fills
 * Individual execution fill records.
 */
export interface FillsRow {
  id: string;
  order_id: string;         // FK → orders.id
  symbol: string;
  side: string;
  qty: number;
  price: number;
  notional: number;
  commission: number;
  ts: string;               // ISO timestamp
  exchange: string | null;
}

/**
 * Table: portfolio_snapshots
 * Point-in-time portfolio state records for equity curve charting.
 */
export interface PortfolioSnapshotsRow {
  id: string;
  ts: string;               // ISO timestamp
  cash: number;
  positions_value: number;
  equity: number;
  initial_capital: number;
  total_unrealized_pnl: number;
  total_realized_pnl: number;
  total_pnl: number;
  return_pct: number;
  positions: object;        // JSON array of Position objects
  position_count: number;
  strategy_run_id: string | null;  // FK → strategy_runs.id (null for live snapshots)
}

/**
 * Table: backtest_results
 * Persisted results from completed backtest runs.
 */
export interface BacktestResultsRow {
  id: string;
  config: object;           // Full JSON BacktestConfig
  status: string;           // "pending" | "running" | "completed" | "failed"
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  final_portfolio: object;  // JSON PortfolioSnapshot
  metrics: object;          // JSON PerformanceMetrics
  equity_curve: object;     // JSON PortfolioSnapshot[]
  orders: object;           // JSON Order[]
  fills: object;            // JSON Fill[]
  event_count: number;
  created_at: string;
}

/**
 * Table: event_logs
 * Recorded TradingEvent streams for replay sessions.
 */
export interface EventLogsRow {
  id: string;
  name: string;
  description: string | null;
  source: string;
  run_id: string | null;
  event_count: number;
  events: object;           // JSON TradingEvent[] — consider chunking for large logs
  start_date: string;
  end_date: string;
  created_at: string;
}
