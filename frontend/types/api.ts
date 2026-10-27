/**
 * types/api.ts
 *
 * Generic API response wrapper types used across all service calls.
 */

export interface ApiError {
  error: string;
  statusCode?: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type SystemHealthStatus = "healthy" | "degraded" | "unhealthy";
export type ExecutionMode = "paper" | "live" | "backtest" | "replay" | "unknown";

// Health status for each specific service: backend server, supabase, alpaca
export interface ServiceHealth {
  health: boolean;
  error?: string;
  accountStatus?: string;
}

/** What market data the trading runtime receives (backend core/live/marketDataMonitor.ts). */
export type MarketDataState = "live" | "stale" | "idle" | "market_closed" | "disconnected" | "no_data";

export interface MarketDataStatus {
  source: "alpaca-stream" | "none";
  /** Alpaca feed: "iex" on free keys, "sip" on a paid plan. */
  feed: string | null;
  state: MarketDataState;
  connected: boolean;
  subscribedSymbols: number;
  lastBarAt: number | null;
  staleAfterMs: number;
  message: string;
}

/** Where the trading runtime sends orders, and the account it resolved at boot. */
export interface ExecutionInfo {
  target: string | null;
  brokerAccount: string | null;
}

export interface SystemStatus {
  status: SystemHealthStatus;
  services: {
    backend: ServiceHealth;
    supabase: ServiceHealth;
    alpaca: ServiceHealth;
  };
  mode: ExecutionMode;
  execution?: ExecutionInfo;
  /** Null on a backend with no trading engine (API-only). */
  marketData?: MarketDataStatus | null;
  build?: { origin: string; sha: string; dirty: boolean };
  ts: string;
}

/**
 * How a backtest prices its orders (backend core/execution/quoteFillModel.ts).
 * Fields left out take the server's defaults.
 */
export interface ExecutionSettings {
  /** "bar": the next bar's open with a synthetic spread. "quote": the real bid/ask when the order reaches the market. */
  model: "bar" | "quote";
  /** Decision-to-market delay assumed for every order (ms). */
  latencyMs?: number;
  quoteLookbackMs?: number;
  maxQuoteWaitMs?: number;
  extraSlippageBps?: number;
  feed?: "sip" | "iex";
}

export interface BacktestConfig {
  id?: string;
  name: string;
  strategyConfig: Record<string, unknown>;
  startDate: string;
  endDate: string;
  initialCapital: number;
  dataGranularity: "bar" | "quote" | "trade";
  commissionPerShare: number;
  /** Set when the user picked a saved strategy; written to backtest_results.strategy_id */
  strategyId?: string;
  /**
   * The strategy_versions row this run is testing — set alongside strategyId
   * when that strategy has version history. Lets a proposal find this backtest
   * via "backtests for this exact version" once it's saved.
   */
  strategyVersionId?: string;
  description?: string;
  /** Annualized risk-free rate for Sharpe/Sortino (default 0) */
  riskFreeRateAnnual?: number;
  /** Set on a backtest that replays a live run's window ("Compare with backtest"). */
  sourceRunId?: string;
  /** Optional benchmark equity/return series — must be chronologically ordered */
  benchmarkCurve?: { ts: number; value: number }[];
  /** Fill model override; merged with server defaults when supplied */
  fillModel?: Record<string, unknown>;
  /** How orders are priced; omitted means the bar model (next bar's open). */
  execution?: ExecutionSettings;
  /** Risk configuration override merged with server defaults for this run */
  riskConfig?: {
    gapBufferBps?: number;
    spreadBufferBps?: number;
    maxIntradayDrawdownPct?: number;
    cashReservePct?: number;
    maxGrossExposurePct?: number;
    maxNetExposurePct?: number;
  };
}

export interface BacktestResult {
  id: string;
  config: BacktestConfig & { strategyVersion?: number };
  status: "pending" | "running" | "completed" | "failed";
  started_at: number;
  completed_at?: number;
  error_message?: string;
  /** Algorithm version that ran this backtest — snapshot at run time. */
  strategy_version?: number;
  metrics?: import("./portfolio").PerformanceMetrics;
  equity_curve?: import("./portfolio").PortfolioSnapshot[];
  event_count?: number;
  /** Set when this result was served from a previous identical run. */
  reused_from_id?: string;
  /**
   * Present only once someone has explicitly saved this result — a fresh run
   * lives only in server memory until POST /backtests/:id/save. Absence means
   * "not saved yet," not "unknown."
   */
  owner_id?: string;
  saved_at?: number;
  /** For a run not yet saved: when it stops being saveable (Unix ms). */
  result_expires_at?: number;
}

export type ReplaySpeed = 0.25 | 0.5 | 1 | 2 | 5 | 10 | "step";
export type ReplayStatus = "idle" | "playing" | "paused" | "completed" | "error";

export interface ReplaySession {
  id: string;
  name: string;
  totalEvents: number;
  cursor: number;
  status: ReplayStatus;
  speed: ReplaySpeed;
  simulatedNow: number;
}
