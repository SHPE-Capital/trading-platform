/**
 * core/broker/IBroker.ts
 *
 * Read side of a broker account: what it holds and what executed. The sync job,
 * the drift check, and the account views read through this, so an Alpaca
 * account and a local sim book look the same to them.
 */

export interface BrokerAccountSnapshot {
  accountId: string;
  status: string;
  cash: number;
  equity: number;
  /** Equity at the previous close, for the day's change. */
  lastEquity: number;
  buyingPower: number;
}

export interface BrokerPosition {
  symbol: string;
  /** Signed: negative for a short. */
  qty: number;
  avgEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
}

export interface BrokerOrder {
  brokerOrderId: string;
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  filledQty: number;
  avgFillPrice: number | null;
  orderType: string;
  timeInForce: string;
  limitPrice: number | null;
  stopPrice: number | null;
  /** Broker status, e.g. new, partially_filled, filled, canceled, expired, rejected. */
  status: string;
  submittedAt: number;
  updatedAt: number;
  /** When it reached a terminal state, if it has. */
  closedAt: number | null;
}

export interface BrokerFill {
  /** Broker execution id; unique per account. */
  brokerFillId: string;
  brokerOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  ts: number;
}

export interface BrokerFee {
  id: string;
  ts: number;
  /** Signed as the broker reports it: a charge is negative. */
  amount: number;
  description: string | null;
}

export interface BrokerHistoryPoint {
  ts: number;
  equity: number;
  profitLoss: number;
  profitLossPct: number;
}

export interface IBroker {
  readonly accountId: string;
  getAccount(): Promise<BrokerAccountSnapshot>;
  getPositions(): Promise<BrokerPosition[]>;
  /** Every order submitted at or after `afterMs`, oldest first. */
  listOrders(afterMs: number): Promise<BrokerOrder[]>;
  getOrder(brokerOrderId: string): Promise<BrokerOrder | null>;
  /** Every fill at or after `afterMs`, oldest first. */
  listFills(afterMs: number): Promise<BrokerFill[]>;
  /** Every fee at or after `afterMs`, oldest first. */
  listFees(afterMs: number): Promise<BrokerFee[]>;
  getPortfolioHistory(period: string, timeframe: string): Promise<BrokerHistoryPoint[]>;
}

/** Order states after which nothing more can fill. */
export const TERMINAL_ORDER_STATUSES = new Set([
  "filled", "canceled", "expired", "rejected", "replaced",
]);
