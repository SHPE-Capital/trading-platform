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
}

export interface PerformanceMetrics {
  totalReturn: number;
  totalReturnPct: number;
  maxDrawdown: number;
  sharpeRatio?: number;
  winRate: number;
  totalTrades: number;
  avgWin: number;
  avgLoss: number;
  periodStart: number;
  periodEnd: number;
}
