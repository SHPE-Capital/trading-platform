
import { BacktestEngine } from "../../core/backtest/backtestEngine";
import { BacktestLoader } from "../../core/backtest/backtestLoader";
import { PairsStrategy } from "../../strategies/pairs/pairsStrategy";
import { Bar } from "../../types/market";
import { BacktestConfig } from "../../types/backtest";
import { UUID } from "../../types/common";

jest.mock("../../core/backtest/backtestLoader");

describe("BacktestEngine Integration", () => {
  let engine: BacktestEngine;
  const INITIAL_CAPITAL = 100000;

  beforeEach(() => {
    engine = new BacktestEngine();
  });

  const createSyntheticBars = (symbol: string, startPrice: number, count: number, zPattern: number[]): Bar[] => {
    return zPattern.map((z, i) => ({
      symbol,
      ts: 1672531200000 + i * 60000,
      isoTs: new Date(1672531200000 + i * 60000).toISOString(),
      open: startPrice + z,
      high: startPrice + z + 0.1,
      low: startPrice + z - 0.1,
      close: startPrice + z,
      volume: 1000,
      vwap: startPrice + z,
      timeframe: "1Min",
    }));
  };

  test("INT 2.1 — Deterministic engine run with synthetic data", async () => {
    // Pattern that crosses z-score thresholds (±2.0)
    const pattern = [0, 1, 2, 3, 2, 1, 0, -1, -2, -3, -2, -1, 0];
    const barsSPY = createSyntheticBars("SPY", 400, pattern.length, pattern);
    const barsQQQ = createSyntheticBars("QQQ", 300, pattern.length, pattern.map(v => -v)); // Opposite pattern for spread widening

    const allBars = [...barsSPY, ...barsQQQ].sort((a, b) => a.ts - b.ts);
    (BacktestLoader.prototype.loadBars as jest.Mock).mockResolvedValue(allBars);

    const config: BacktestConfig = {
      id: "run-1" as UUID,
      name: "Test Run",
      strategyConfig: {
        id: "strat-1",
        name: "Pairs",
        symbols: ["SPY", "QQQ"],
        enabled: true,
        type: "pairs_trading",
        leg1Symbol: "SPY",
        leg2Symbol: "QQQ",
        rollingWindowMs: 3600000, // 1 hour
        olsWindowMs: 7200000, // 2 hours
        minObservations: 1,
        entryZScore: 1.0,
        exitZScore: 0.5,
        stopLossZScore: 10.0,
        maxHoldingTimeMs: 86400000,
        tradeNotionalUsd: 10000,
        priceSource: "mid",
        orderCooldownMs: 0,
        hedgeRatioMethod: "fixed",
        fixedHedgeRatio: 1.0,
      } as any,
      startDate: "2023-01-01T00:00:00Z",
      endDate: "2023-01-01T01:00:00Z",
      initialCapital: INITIAL_CAPITAL,
      dataGranularity: "bar",
      slippageBps: 0,
      commissionPerShare: 0,
    };

    // Enable debug to see signal funnel
    process.env.BACKTEST_DEBUG = "1";

    const strategyFactory = () => [new PairsStrategy(config.strategyConfig as any)];

    const result = await engine.run(config, strategyFactory);

    // Assert CHECK 7 invariants
    const fp = result.final_portfolio;
    const m = result.metrics;

    const isClose = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6, 1e-9 * Math.max(Math.abs(a), Math.abs(b)));

    expect(isClose(fp.equity, fp.cash + fp.positionsValue)).toBe(true);
    expect(isClose(m.totalReturn, fp.totalRealizedPnl + fp.totalUnrealizedPnl)).toBe(true);
    expect(isClose(m.totalReturn, fp.equity - INITIAL_CAPITAL)).toBe(true);
    expect(m.totalReturnPct).toBe(m.totalReturn / INITIAL_CAPITAL);
    expect(m.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(m.maxDrawdown).toBeLessThanOrEqual(1);
    expect(result.equity_curve.length).toBeLessThanOrEqual(5000);
    expect(result.equity_curve[0].equity).toBe(INITIAL_CAPITAL);

    expect(result.orders.length).toBeGreaterThan(0);
    expect(result.fills.length).toBeGreaterThan(0);
  });

  test("INT 2.2 — Pairs leg consistency", async () => {
    // With the leg1-only guard, evaluate() runs on SPY bars only. When SPY bar i fires it
    // reads QQQ from bar i-1, giving spread_i = 100 + p_i + p_{i-1}.
    // Pattern [0,0,3,3,0] → spreads [100, 103, 106, 103]: enough variance for z=1.0 entry
    // on the 4th SPY bar and z≈0 exit on the 5th.
    const pattern = [0, 0, 3, 3, 0];
    const barsSPY = createSyntheticBars("SPY", 400, pattern.length, pattern);
    const barsQQQ = createSyntheticBars("QQQ", 300, pattern.length, pattern.map(v => -v));
    const allBars = [...barsSPY, ...barsQQQ].sort((a, b) => a.ts - b.ts);
    (BacktestLoader.prototype.loadBars as jest.Mock).mockResolvedValue(allBars);

    const config: any = {
      id: "run-2",
      strategyConfig: {
        id: "strat-1", enabled: true, symbols: ["SPY", "QQQ"], leg1Symbol: "SPY", leg2Symbol: "QQQ",
        rollingWindowMs: 3600000, olsWindowMs: 7200000, minObservations: 1,
        entryZScore: 1.0, exitZScore: 0.5, stopLossZScore: 10, maxHoldingTimeMs: 86400000,
        tradeNotionalUsd: 10000, priceSource: "mid", orderCooldownMs: 0,
        hedgeRatioMethod: "fixed", fixedHedgeRatio: 1.0, type: "pairs_trading"
      },
      initialCapital: 100000,
      dataGranularity: "bar",
      slippageBps: 0, commissionPerShare: 0,
      startDate: "2023-01-01T00:00:00Z", endDate: "2023-01-01T01:00:00Z"
    };
    const strategyFactory = () => [new PairsStrategy(config.strategyConfig)];

    const result = await engine.run(config as any, strategyFactory);

    // Each entry signal should produce exactly 2 fills (one per symbol)
    // 1 entry (2 fills) + 1 exit (2 fills) = 4 fills total
    expect(result.fills.length).toBe(4);

    // Entry fires on the 4th SPY bar (index 3), which is allBars[6] in the interleaved sorted array
    const entryFills = result.fills.filter(f => f.ts === allBars[6].ts);
    expect(entryFills).toHaveLength(2);
    expect(new Set(entryFills.map(f => f.symbol))).toEqual(new Set(["SPY", "QQQ"]));
  });

  test("INT 2.3 — Zero-crossing flip in the engine", async () => {
    const pattern = [0, 1, 2, -2, -3];
    const barsSPY = createSyntheticBars("SPY", 400, pattern.length, pattern);
    const barsQQQ = createSyntheticBars("QQQ", 300, pattern.length, pattern.map(v => -v));
    (BacktestLoader.prototype.loadBars as jest.Mock).mockResolvedValue([...barsSPY, ...barsQQQ].sort((a, b) => a.ts - b.ts));

    const config: any = {
        id: "run-3",
        strategyConfig: {
            id: "strat-1", enabled: true, symbols: ["SPY", "QQQ"], leg1Symbol: "SPY", leg2Symbol: "QQQ",
            rollingWindowMs: 3600000, olsWindowMs: 7200000, minObservations: 1,
            entryZScore: 1.0, exitZScore: 0.5, stopLossZScore: 10, maxHoldingTimeMs: 86400000,
            tradeNotionalUsd: 10000, priceSource: "mid", orderCooldownMs: 0,
            hedgeRatioMethod: "fixed", fixedHedgeRatio: 1.0, type: "pairs_trading"
        },
        initialCapital: 100000,
        dataGranularity: "bar", slippageBps: 0, commissionPerShare: 0,
        startDate: "2023-01-01T00:00:00Z", endDate: "2023-01-01T01:00:00Z"
    };
    const result = await engine.run(config as any, () => [new PairsStrategy(config.strategyConfig)]);

    expect(result.final_portfolio.equity).toBeGreaterThan(0);
    // CHECK 7 holds
    const fp = result.final_portfolio;
    expect(Math.abs(fp.equity - (fp.cash + fp.positionsValue))).toBeLessThan(1e-6);
  });

  test("INT 2.5 — Signal->intent listener single-fire", async () => {
    // Needs 3 SPY-bar evaluations with non-uniform spreads so z-score is calculable.
    // Pattern [0,0,3,3]: spreads [100, 103, 106] → z=1.0 on bar 3 fires exactly 1 entry = 2 orders.
    const pattern = [0, 0, 3, 3];
    const barsSPY = createSyntheticBars("SPY", 400, pattern.length, pattern);
    const barsQQQ = createSyntheticBars("QQQ", 300, pattern.length, pattern.map(v => -v));
    (BacktestLoader.prototype.loadBars as jest.Mock).mockResolvedValue([...barsSPY, ...barsQQQ].sort((a, b) => a.ts - b.ts));

    const config: any = {
        id: "run-4",
        strategyConfig: {
            id: "strat-1", enabled: true, symbols: ["SPY", "QQQ"], leg1Symbol: "SPY", leg2Symbol: "QQQ",
            rollingWindowMs: 3600000, olsWindowMs: 7200000, minObservations: 1,
            entryZScore: 1.0, exitZScore: 0.5, stopLossZScore: 10, maxHoldingTimeMs: 86400000,
            tradeNotionalUsd: 10000, priceSource: "mid", orderCooldownMs: 0,
            hedgeRatioMethod: "fixed", fixedHedgeRatio: 1.0, type: "pairs_trading"
        },
        initialCapital: 100000,
        dataGranularity: "bar", slippageBps: 0, commissionPerShare: 0,
        startDate: "2023-01-01T00:00:00Z", endDate: "2023-01-01T01:00:00Z"
    };

    const result = await engine.run(config as any, () => [new PairsStrategy(config.strategyConfig)]);

    expect(result.orders.length).toBe(2);
  });

  test("INT 2.4 — Simulated clock isolation", async () => {
    const bars = createSyntheticBars("SPY", 100, 10, [0]);
    (BacktestLoader.prototype.loadBars as jest.Mock).mockResolvedValue(bars);

    const config: any = { strategyConfig: { symbols: ["SPY"] }, initialCapital: 100000 };
    const strategyFactory = () => [];

    const wallClockStart = Date.now();
    await engine.run(config, strategyFactory);
    const wallClockEnd = Date.now();

    // Date.now() should be back to real time
    expect(Date.now()).toBeGreaterThanOrEqual(wallClockStart);
    expect(Date.now()).toBeLessThanOrEqual(wallClockEnd + 100); // 100ms buffer

    // Test exception case
    const errorEngine = new BacktestEngine();
    (BacktestLoader.prototype.loadBars as jest.Mock).mockRejectedValue(new Error("Loader failed"));

    try {
        await errorEngine.run(config, strategyFactory);
    } catch (e) {
        // Expected
    }

    expect(Date.now()).toBeGreaterThanOrEqual(wallClockStart);
  });
});
