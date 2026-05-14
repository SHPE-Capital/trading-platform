
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

  test("Partial closes — open 10, close 5, close 5 — count as 2 trades and preserve PnL on both slices", () => {
    // Fix #5: previous FIFO dropped the residual when the closer qty < opener qty.
    // With lot accounting, the 10-share buy is split into two 5-share slices,
    // each matched against one of the closers. Trade-count definition: one
    // realized PnL entry per closer-vs-opener slice.
    const fills: Fill[] = [
      createFill("SPY", "buy", 10, 100),
      createFill("SPY", "sell", 5, 110), // slice 1: PnL = (110-100)*5 = 50
      createFill("SPY", "sell", 5, 115), // slice 2: PnL = (115-100)*5 = 75
    ];

    const ec = [createSnapshot(100000), createSnapshot(100125)];
    const metrics = engine._computeMetrics(ec, fills, 100000, 0, 1000);

    expect(metrics.totalTrades).toBe(2);
    expect(metrics.winRate).toBe(1.0);
    // avgWin = (50+75)/2 = 62.5
    expect(metrics.avgWin).toBeCloseTo(62.5, 4);
  });

  test("Short cover symmetric — short 10, cover 5, cover 5 — counts as 2 trades", () => {
    const fills: Fill[] = [
      createFill("SPY", "sell", 10, 110),
      createFill("SPY", "buy", 5, 100), // slice 1: PnL = (110-100)*5 = 50
      createFill("SPY", "buy", 5, 95),  // slice 2: PnL = (110-95)*5 = 75
    ];
    const ec = [createSnapshot(100000), createSnapshot(100125)];
    const metrics = engine._computeMetrics(ec, fills, 100000, 0, 1000);
    expect(metrics.totalTrades).toBe(2);
    expect(metrics.winRate).toBe(1.0);
    expect(metrics.avgWin).toBeCloseTo(62.5, 4);
  });

  test("Closer larger than opener — buy 5 then sell 10 — closes 5 and opens a 5-share short", () => {
    const fills: Fill[] = [
      createFill("SPY", "buy", 5, 100),
      createFill("SPY", "sell", 10, 110), // 5 closes long, 5 opens short
      createFill("SPY", "buy", 5, 105),   // covers the new short: PnL = (110-105)*5 = 25
    ];
    const ec = [createSnapshot(100000), createSnapshot(100075)];
    const metrics = engine._computeMetrics(ec, fills, 100000, 0, 1000);
    // First slice (close long): (110-100)*5 = 50. Second slice (cover short): 25.
    expect(metrics.totalTrades).toBe(2);
    expect(metrics.avgWin).toBeCloseTo((50 + 25) / 2, 4);
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
