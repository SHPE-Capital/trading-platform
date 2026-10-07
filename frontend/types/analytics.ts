/**
 * types/analytics.ts
 *
 * Live run and strategy performance (GET /runs/:id/performance,
 * /strategies/:id/performance) and the broker's view of the account
 * (GET /broker/*). Mirrors backend/src/types/analytics.ts.
 */

export interface RoundTrip {
  symbol: string;
  direction: "long" | "short";
  qty: number;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  commission: number;
  holdingMs: number;
}

export interface OpenPosition {
  symbol: string;
  qty: number;
  avgPrice: number;
  markPrice: number;
  unrealizedPnl: number;
}

export interface StrategyRunStats {
  runId: string;
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
  lastFillAt: number | null;
  updatedAt: number;
}

export interface LiveMetrics {
  totalReturn: number;
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
  ts: number;
  equity: number;
  pnl: number;
  runId?: string;
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
  noOrder: number;
  orders: number;
  filledOrders: number;
  canceledOrders: number;
  rejectedOrders: number;
  fills: number;
}

export interface SlippageSummary {
  measuredFills: number;
  avgBps: number;
  medianBps: number;
  totalCost: number;
  bySymbol: Array<{ symbol: string; fills: number; avgBps: number; totalCost: number }>;
}

export interface RunSummary {
  runId: string;
  name: string;
  status: string;
  executionMode: string;
  runtimeOrigin: string;
  versionId: string | null;
  versionNumber: number | null;
  sandbox: boolean;
  backfill: boolean;
  startedAt: number | null;
  stoppedAt: number | null;
  pnl: number;
  trades: number;
  orders: number;
  signals: number;
}

export interface RunnerEvent {
  ts: number;
  type: string;
  detail: string | null;
}

export interface PerformanceReport {
  scope: "run" | "strategy";
  id: string;
  name: string;
  strategyType: string;
  capitalBase: number;
  periodStart: number;
  periodEnd: number;
  metrics: LiveMetrics;
  equityCurve: EquityCurvePoint[];
  trades: RoundTrip[];
  bySymbol: SymbolBreakdown[];
  openPositions: OpenPosition[];
  funnel: SignalFunnel;
  rejectionsByCheck: Array<{ check: string; count: number }>;
  slippage: SlippageSummary;
  holdingTimes: Array<{ bucket: string; trades: number; pnl: number }>;
  /** Gross and net exposure over time, from the run's sampled book. */
  exposureCurve: Array<{ ts: number; gross: number; net: number }>;
  /** Buy-and-hold of the benchmark over the same window, as dollar PnL on the capital base. */
  benchmark?: { symbol: string; curve: Array<{ ts: number; pnl: number }> };
  runs?: RunSummary[];
  events?: RunnerEvent[];
}

export interface RunSignal {
  id: string;
  ts: number;
  symbol: string | null;
  direction: string | null;
  outcome: string;
  reason: string | null;
}

// ------------------------------------------------------------------
// Broker
// ------------------------------------------------------------------

export interface BrokerAccount {
  accountId: string;
  status: string;
  cash: number;
  equity: number;
  lastEquity: number;
  buyingPower: number;
  executionTarget: string | null;
}

export interface BrokerPosition {
  symbol: string;
  qty: number;
  avgEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
}

export interface BrokerHistoryPoint {
  ts: number;
  equity: number;
  profitLoss: number;
  profitLossPct: number;
}

export interface DriftRow {
  symbol: string;
  brokerQty: number;
  runningQty: number;
  stoppedQty: number;
  unattributedQty: number;
  checkedAt?: number;
}
