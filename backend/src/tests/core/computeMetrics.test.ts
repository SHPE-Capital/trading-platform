
import { BacktestEngine } from "../../core/backtest/backtestEngine";
import { Fill } from "../../types/orders";
import { PortfolioSnapshot } from "../../types/portfolio";
import { UUID } from "../../types/common";

describe("BacktestEngine._computeMetrics", () => {
  let engine: any;

  beforeEach(() => {
    // We don't need real dependencies to test the pure private method
    engine = new BacktestEngine();
  });

  const createFill = (symbol: string, side: "buy" | "sell", qty: number, price: number, commission = 0): Fill => ({
    id: "f" as UUID,
    orderId: "o" as UUID,
    symbol,
    side,
    qty,
    price,
    notional: qty * price,
    commission,
    ts: Date.now(),
    isoTs: new Date().toISOString(),
  });

  const createSnapshot = (equity: number): PortfolioSnapshot => ({
    id: "s" as UUID,
    ts: Date.now(),
    isoTs: new Date().toISOString(),
    cash: equity,
    positionsValue: 0,
    equity,
    initialCapital: 100000,
    totalUnrealizedPnl: 0,
    totalRealizedPnl: 0,
    totalPnl: 0,
    returnPct: 0,
    positions: [],
    positionCount: 0,
  });

  test("Mixed long and short round-trips counted in totalTrades", () => {
    const fills: Fill[] = [
      // Long round trip: Buy 100, Sell 110
      createFill("SPY", "buy", 10, 100),
      createFill("SPY", "sell", 10, 110),
      // Short round trip: Sell 100, Buy 90
      createFill("QQQ", "sell", 10, 100),
      createFill("QQQ", "buy", 10, 90),
    ];

    const ec = [createSnapshot(100000), createSnapshot(100200)];
    const metrics = engine._computeMetrics(ec, fills, 100000, 0, 1000);

    expect(metrics.totalTrades).toBe(2);
    expect(metrics.winRate).toBe(1.0);
    expect(metrics.totalReturn).toBe(200);
  });

  test("Partial closes do not double-count totalTrades", () => {
    const fills: Fill[] = [
      createFill("SPY", "buy", 10, 100),
      createFill("SPY", "sell", 5, 110), // Half closed
      createFill("SPY", "sell", 5, 115), // Other half closed
    ];

    const ec = [createSnapshot(100000), createSnapshot(100100)];
    const metrics = engine._computeMetrics(ec, fills, 100000, 0, 1000);

    // Simple FIFO matcher shifts the entire buy on the first sell, leaving the second sell
    // unmatched. Known limitation: partial closes count as 1 trade, not 2.
    expect(metrics.totalTrades).toBe(1);
  });

  test("totalReturn is sourced from ledger (equity curve), not fills sum", () => {
    const fills: Fill[] = [
      createFill("SPY", "buy", 10, 100),
      createFill("SPY", "sell", 10, 110), // $100 profit
    ];
    // Equity curve shows $150 profit (maybe from some other source or marked-up price)
    const ec = [createSnapshot(100000), createSnapshot(100150)];
    const metrics = engine._computeMetrics(ec, fills, 100000, 0, 1000);

    expect(metrics.totalReturn).toBe(150); // Ledger is source of truth
  });
});
