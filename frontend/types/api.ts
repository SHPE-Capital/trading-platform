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

export interface SystemStatus {
  engineRunning: boolean;
  mode: string;
  connectedToAlpaca: boolean;
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
  startedAt: number;
  completedAt?: number;
  errorMessage?: string;
  metrics?: import("./portfolio").PerformanceMetrics;
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
