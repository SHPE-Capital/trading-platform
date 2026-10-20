/**
 * types/portfolio.ts
 *
 * Frontend types for portfolio state: positions, snapshots, orders, fills.
 * Mirror the backend portfolio types for API response consumption.
 */

export interface Position {
  id: string;
  symbol: string;
  qty: number;
  avgEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  realizedPnl: number;
  costBasis: number;
  openedAt: number;
  updatedAt: number;
  strategyId?: string;
}

/** One point of a chart-sized equity history (the backend downsamples it). */
export interface EquityPoint {
  ts: number;
  isoTs: string;
  equity: number;
  initialCapital: number;
}

export interface PortfolioSnapshot {
  id: string;
  ts: number;
  isoTs: string;
  cash: number;
  positionsValue: number;
  equity: number;
  initialCapital: number;
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;
  totalPnl: number;
  returnPct: number;
  positions: Position[];
  positionCount: number;
}

export interface Fill {
  id: string;
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  notional: number;
  commission: number;
  ts: number;
  isoTs: string;
}

export interface Order {
  id: string;
  brokerOrderId?: string;
  strategyId: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  filledQty: number;
  avgFillPrice?: number;
  orderType: string;
  limitPrice?: number;
  status: string;
  submittedAt: number;
  updatedAt: number;
  closedAt?: number;
  fills: Fill[];
  /** Run that sent the order; absent for orders no run accounts for. */
  runId?: string;
  /** Price when the strategy decided — the slippage baseline. */
  decisionPrice?: number;
}

export interface PerformanceMetrics {
  totalReturn: number;
  totalReturnPct: number;
  maxDrawdown: number;
  sharpeRatio?: number;
  sortinoRatio?: number;
  calmarRatio?: number;
  profitFactor?: number;
  winRate: number;
  totalTrades: number;
  avgWin: number;
  avgLoss: number;
  periodStart: number;
  periodEnd: number;
  meta?: {
    annualizedReturn?: number;
    annualizedVol?: number;
    riskFreeRateAnnual?: number;
    benchmarkReturn?: number;
    returnPeriods?: number;
    /** Present when the backtest priced orders from real quotes. */
    execution?: ExecutionReport;
  };
}

/** How a quote-model backtest priced its orders (backend ExecutionReport). */
export interface ExecutionReport {
  model: "bar" | "quote";
  latencyMs: number;
  feed: "sip" | "iex";
  extraSlippageBps: number;
  /** Fills priced from a quote on arrival, from trades through a resting limit, and by the bar model. */
  fills: { quote: number; trade: number; bar: number };
  /** Orders priced by the bar model instead, by reason. */
  fallbacks: Record<string, number>;
  /** IOC limits that were not marketable when they arrived. */
  expiredUnmarketable: number;
  /** Resting DAY orders still unfilled at the close. */
  expiredAtClose?: number;
  stopsTriggered?: number;
  /** Minutes a resting order could not be checked because trades were unavailable. */
  tradeDataUnavailable: number;
  /** Notional-weighted cost of crossing the spread, vs the mid on arrival (bps). */
  avgSpreadCostBps: number | null;
  /** Notional-weighted move of the mid between decision and arrival, against the order (bps). */
  avgDelayCostBps: number | null;
}
