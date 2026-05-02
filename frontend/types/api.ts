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

export interface SystemStatus {
  status: SystemHealthStatus;
  services: {
    backend: ServiceHealth;
    supabase: ServiceHealth;
    alpaca: ServiceHealth;
  };
  mode: ExecutionMode;
  ts: string;
}

export interface BacktestConfig {
  id?: string;
  name: string;
  strategyConfig: Record<string, unknown>;
  startDate: string;
  endDate: string;
  initialCapital: number;
  dataGranularity: "bar" | "quote" | "trade";
  slippageBps: number;
  commissionPerShare: number;
  description?: string;
}

export interface BacktestResult {
  id: string;
  config: BacktestConfig;
  status: "pending" | "running" | "completed" | "failed";
  started_at: number;
  completed_at?: number;
  error_message?: string;
  metrics?: import("./portfolio").PerformanceMetrics;
  equity_curve?: import("./portfolio").PortfolioSnapshot[];
  event_count?: number;
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
