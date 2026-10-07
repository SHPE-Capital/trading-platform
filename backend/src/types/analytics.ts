/**
 * types/analytics.ts
 *
 * Live run and strategy performance, derived from the ledger. The metric names
 * match a backtest's PerformanceMetrics so both render with the same panel.
 */

import type { RoundTrip } from "../core/analytics/tradeLedger";
import type { EpochMs, UUID } from "./common";

export interface StrategyRunStats {
  runId: UUID;
  signals: number;
  orders: number;
  filledOrders: number;
  fills: number;
  rejections: number;
  closedTrades: number;
  realizedPnl: number;
  unrealizedPnl: number;
  fees: number;
  openPositions: OpenPosition[];
  lastFillAt: EpochMs | null;
  updatedAt: EpochMs;
}

export interface OpenPosition {
  symbol: string;
  /** Signed: negative for a short. */
  qty: number;
  avgPrice: number;
  markPrice: number;
  unrealizedPnl: number;
}

export interface LiveMetrics {
  /** PnL in dollars (realized + unrealized). */
  totalReturn: number;
  /** PnL over the capital base. */
  totalReturnPct: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  avgWin: number;
  avgLoss: number;
  sharpeRatio?: number;
  sortinoRatio?: number;
  calmarRatio?: number;
  profitFactor?: number;
  annualizedReturn?: number;
  benchmarkReturn?: number;
  realizedPnl: number;
  unrealizedPnl: number;
  fees: number;
}

export interface EquityCurvePoint {
  ts: EpochMs;
  /** Capital base + PnL. */
  equity: number;
  pnl: number;
  /** Run the point belongs to (strategy reports chain several). */
  runId?: UUID;
}

export interface SymbolBreakdown {
  symbol: string;
  realizedPnl: number;
  unrealizedPnl: number;
  trades: number;
  winRate: number;
}

export interface SignalFunnel {
  signals: number;
  submitted: number;
  riskRejected: number;
  capitalUnavailable: number;
  /** Signals that never became an order (e.g. a leg rounded to zero). */
  noOrder: number;
  orders: number;
  filledOrders: number;
  canceledOrders: number;
  rejectedOrders: number;
  fills: number;
}

export interface SlippageSummary {
  /** Fills with a known decision price. */
  measuredFills: number;
  /** Signed, in basis points: positive = paid more than the decision price (worse). */
  avgBps: number;
  medianBps: number;
  /** Dollars lost to slippage across measured fills. */
  totalCost: number;
  bySymbol: Array<{ symbol: string; fills: number; avgBps: number; totalCost: number }>;
}

export interface RunSummary {
  runId: UUID;
  name: string;
  status: string;
  executionMode: string;
  runtimeOrigin: string;
  versionId: UUID | null;
  versionNumber: number | null;
  sandbox: boolean;
  backfill: boolean;
  startedAt: EpochMs | null;
  stoppedAt: EpochMs | null;
  pnl: number;
  trades: number;
  orders: number;
  signals: number;
}

export interface RunnerEvent {
  ts: EpochMs;
  type: string;
  detail: string | null;
}

export interface PerformanceReport {
  scope: "run" | "strategy";
  id: UUID;
  name: string;
  strategyType: string;
  capitalBase: number;
  periodStart: EpochMs;
  periodEnd: EpochMs;
  metrics: LiveMetrics;
  equityCurve: EquityCurvePoint[];
  /** Most recent closed trades, newest last. */
  trades: RoundTrip[];
  bySymbol: SymbolBreakdown[];
  openPositions: OpenPosition[];
  funnel: SignalFunnel;
  rejectionsByCheck: Array<{ check: string; count: number }>;
  slippage: SlippageSummary;
  /** Holding time of closed trades, bucketed. */
  holdingTimes: Array<{ bucket: string; trades: number; pnl: number }>;
  /** Strategy reports: the runs that make it up. */
  runs?: RunSummary[];
  /** Run reports: lease adoptions, error streaks, auto-disables. */
  events?: RunnerEvent[];
}
