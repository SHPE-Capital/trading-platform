jest.mock('../../config/env', () => ({
  env: {
    alpacaApiKey: 'test-key',
    alpacaApiSecret: 'test-secret',
    alpacaTradingMode: 'paper',
    alpacaPaperBaseUrl: 'https://paper-api.alpaca.markets',
    alpacaLiveBaseUrl: 'https://api.alpaca.markets',
    alpacaDataStreamUrl: 'wss://stream.data.alpaca.markets/v2',
    alpacaPaperStreamUrl: 'wss://paper-api.alpaca.markets/stream',
    alpacaLiveStreamUrl: 'wss://api.alpaca.markets/stream',
    supabaseUrl: 'https://test.supabase.co',
    supabaseAnonKey: 'test-anon',
    supabaseServiceRoleKey: 'test-service',
    port: 8080,
    nodeEnv: 'test',
    corsOrigin: 'http://localhost:3000',
    logLevel: 'error',
    defaultRollingWindowMs: 60_000,
    maxPositionSizeUsd: 10_000,
    maxNotionalExposureUsd: 50_000,
    orderCooldownMs: 5_000,
    enableLiveTrading: false,
    enableWebSocketPush: true,
    databaseUrl: '',
  },
}));

jest.mock('../../core/backtest/backtestLoader', () => ({
  BacktestLoader: jest.fn().mockImplementation(() => ({
    loadBars: jest.fn().mockResolvedValue([]),
  })),
}));

import { BacktestLoader } from '../../core/backtest/backtestLoader';
import { BacktestEngine } from '../../core/backtest/backtestEngine';
import type { BacktestConfig } from '../../types/backtest';
import type { PortfolioSnapshot } from '../../types/portfolio';
import type { Fill } from '../../types/orders';

const MockLoader = BacktestLoader as jest.MockedClass<typeof BacktestLoader>;

function makeConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    id: 'bt-1',
    name: 'Test Backtest',
    strategyConfig: {
      id: 'strat-1',
      name: 'Test Strategy',
      type: 'pairs_trading',
      symbols: ['SPY', 'AAPL'],
      rollingWindowMs: 3_600_000,
      maxPositionSizeUsd: 10_000,
      cooldownMs: 5_000,
      enabled: true,
    },
    startDate: '2024-01-01T00:00:00Z',
    endDate: '2024-01-31T00:00:00Z',
    initialCapital: 100_000,
    dataGranularity: 'bar',
    slippageBps: 5,
    commissionPerShare: 0.005,
    ...overrides,
  };
}

function makeBar(symbol: string, ts: number, close = 100) {
  return {
    symbol,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 10_000,
    ts,
    isoTs: new Date(ts).toISOString(),
    timeframe: '1Min',
  };
}

function makeSnap(equity: number): PortfolioSnapshot {
  return {
    id: 'snap',
    ts: 0,
    isoTs: '',
    cash: equity,
    positionsValue: 0,
    equity,
    initialCapital: 100_000,
    totalUnrealizedPnl: 0,
    totalRealizedPnl: 0,
    totalPnl: equity - 100_000,
    returnPct: (equity - 100_000) / 100_000,
    positions: [],
    positionCount: 0,
  };
}

function makeFill(symbol: string, side: 'buy' | 'sell', qty: number, price: number): Fill {
  return {
    id: `fill-${Math.random()}`,
    orderId: 'o1',
    symbol,
    side,
    qty,
    price,
    notional: qty * price,
    commission: 0,
    ts: 1_000,
    isoTs: '',
  };
}

function makeEngineWithBars(bars: ReturnType<typeof makeBar>[]) {
  MockLoader.mockImplementation(
    () => ({ loadBars: jest.fn().mockResolvedValue(bars) } as unknown as BacktestLoader),
  );
  return new BacktestEngine();
}

beforeEach(() => {
  MockLoader.mockClear();
  // Default: no bars
  MockLoader.mockImplementation(() => ({ loadBars: jest.fn().mockResolvedValue([]) } as unknown as BacktestLoader));
});

describe('run(): result structure', () => {
  it('returns status=completed with only the final MTM snapshot when there are no bars', async () => {
    const engine = makeEngineWithBars([]);
    const result = await engine.run(makeConfig(), () => []);
    expect(result.status).toBe('completed');
    // The engine always appends a final mark-to-market snapshot after the bar loop,
    // so even with 0 bars the equity curve contains exactly 1 entry.
    expect(result.equity_curve).toHaveLength(1);
    expect(result.fills).toHaveLength(0);
    expect(result.orders).toHaveLength(0);
    expect(result.event_count).toBe(0);
    expect(result.metrics.totalReturn).toBe(0);
  });

  it('equity curve has one snapshot per bar plus a final MTM snapshot', async () => {
    const bars = [makeBar('SPY', 1_000), makeBar('SPY', 2_000), makeBar('SPY', 3_000)];
    const engine = makeEngineWithBars(bars);
    const result = await engine.run(makeConfig(), () => []);
    // N bars → N per-bar snapshots + 1 final MTM = N+1
    expect(result.equity_curve).toHaveLength(4);
    expect(result.event_count).toBe(3);
  });

  it('per-bar snapshots have timestamps matching bar timestamps', async () => {
    const bars = [makeBar('SPY', 1_000), makeBar('SPY', 2_000), makeBar('SPY', 3_000)];
    const engine = makeEngineWithBars(bars);
    const result = await engine.run(makeConfig(), () => []);
    expect(result.equity_curve[0].ts).toBe(1_000);
    expect(result.equity_curve[1].ts).toBe(2_000);
    expect(result.equity_curve[2].ts).toBe(3_000);
    // Final MTM entry has a real-clock timestamp at or after the last bar
    expect(result.equity_curve[3].ts).toBeGreaterThanOrEqual(3_000);
  });

  it('final_portfolio matches the last equity curve entry', async () => {
    const bars = [makeBar('SPY', 1_000)];
    const engine = makeEngineWithBars(bars);
    const result = await engine.run(makeConfig(), () => []);
    const last = result.equity_curve[result.equity_curve.length - 1];
    expect(result.final_portfolio.id).toBe(last.id);
    expect(result.final_portfolio.equity).toBe(last.equity);
  });

  it('all equity snapshots are at initialCapital when no trades are placed', async () => {
    const bars = [makeBar('SPY', 1_000), makeBar('SPY', 2_000)];
    const engine = makeEngineWithBars(bars);
    const result = await engine.run(makeConfig(), () => []);
    result.equity_curve.forEach((snap) => {
      expect(snap.equity).toBe(100_000);
    });
  });

  it('result includes the config used', async () => {
    const cfg = makeConfig({ id: 'bt-unique' });
    const engine = makeEngineWithBars([]);
    const result = await engine.run(cfg, () => []);
    expect(result.id).toBe('bt-unique');
    expect(result.config).toBe(cfg);
  });

  it('event_count reflects bar count not equity curve length', async () => {
    const bars = [makeBar('SPY', 1_000), makeBar('SPY', 2_000)];
    const engine = makeEngineWithBars(bars);
    const result = await engine.run(makeConfig(), () => []);
    expect(result.event_count).toBe(2);
    expect(result.equity_curve.length).toBe(3); // bars + final MTM
  });
});

describe('_computeMetrics', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let computeMetrics: (curve: PortfolioSnapshot[], fills: Fill[], initial: number) => any;

  beforeEach(() => {
    const engine = new BacktestEngine();
    computeMetrics = (engine as unknown as {
      _computeMetrics: typeof computeMetrics
    })._computeMetrics.bind(engine);
  });

  it('empty equity curve returns all-zero metrics', () => {
    const m = computeMetrics([], [], 100_000);
    expect(m.totalReturn).toBe(0);
    expect(m.totalReturnPct).toBe(0);
    expect(m.maxDrawdown).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.totalTrades).toBe(0);
  });

  it('does not include periodStart or periodEnd (removed as dead fields)', () => {
    const m = computeMetrics([makeSnap(100_000)], [], 100_000);
    expect(m).not.toHaveProperty('periodStart');
    expect(m).not.toHaveProperty('periodEnd');
  });

  it('computes totalReturn and totalReturnPct correctly', () => {
    const curve = [makeSnap(110_000)];
    const m = computeMetrics(curve, [], 100_000);
    expect(m.totalReturn).toBe(10_000);
    expect(m.totalReturnPct).toBeCloseTo(0.1, 5);
  });

  it('computes maxDrawdown across equity curve', () => {
    // Peak at 110k, drops to 90k → drawdown = 20k/110k ≈ 18.18%
    const curve = [makeSnap(110_000), makeSnap(90_000), makeSnap(95_000)];
    const m = computeMetrics(curve, [], 100_000);
    expect(m.maxDrawdown).toBeCloseTo(20_000 / 110_000, 4);
  });

  it('no drawdown when equity only increases', () => {
    const curve = [makeSnap(100_000), makeSnap(105_000), makeSnap(110_000)];
    const m = computeMetrics(curve, [], 100_000);
    expect(m.maxDrawdown).toBe(0);
  });

  it('computes winRate, avgWin, avgLoss from paired fills', () => {
    const fills = [
      makeFill('SPY', 'buy', 10, 100),   // buy at 100
      makeFill('SPY', 'sell', 10, 110),  // sell at 110 → pnl = 100
      makeFill('AAPL', 'buy', 5, 200),   // buy at 200
      makeFill('AAPL', 'sell', 5, 180),  // sell at 180 → pnl = -100
    ];
    const m = computeMetrics([makeSnap(100_000)], fills, 100_000);
    expect(m.totalTrades).toBe(2);
    expect(m.winRate).toBe(0.5);
    expect(m.avgWin).toBeCloseTo(100, 1);
    expect(m.avgLoss).toBeCloseTo(-100, 1);
  });

  it('winRate is 1.0 when all trades are profitable', () => {
    const fills = [
      makeFill('SPY', 'buy', 10, 100),
      makeFill('SPY', 'sell', 10, 120),
    ];
    const m = computeMetrics([makeSnap(102_000)], fills, 100_000);
    expect(m.winRate).toBe(1);
    expect(m.totalTrades).toBe(1);
  });

  it('correctly pairs short trades: sell then buy to cover', () => {
    const fills = [
      makeFill('SPY', 'sell', 10, 100), // short at 100
      makeFill('SPY', 'buy', 10, 80),   // cover at 80 → pnl = (100-80)*10 = 200
    ];
    const m = computeMetrics([makeSnap(100_200)], fills, 100_000);
    expect(m.totalTrades).toBe(1);
    expect(m.winRate).toBe(1);
    expect(m.avgWin).toBeCloseTo(200, 1);
  });

  it('winRate is 0 when all trades are losses', () => {
    const fills = [
      makeFill('SPY', 'buy', 10, 100),
      makeFill('SPY', 'sell', 10, 90),  // pnl = -100
    ];
    const m = computeMetrics([makeSnap(99_000)], fills, 100_000);
    expect(m.winRate).toBe(0);
    expect(m.avgLoss).toBeCloseTo(-100, 1);
  });
});

// ------------------------------------------------------------------
// Terminal cleanup: last-bar pending orders
// ------------------------------------------------------------------

import type { IStrategy } from '../../strategies/base/strategy';
import type { UUID } from '../../types/common';
import type { StrategySignal } from '../../types/strategy';

/**
 * Strategy that emits a single buy signal exactly on the final bar — the
 * resulting order has no subsequent bar to fill against and must therefore
 * be expired by the backtest engine's terminal drain.
 */
function makeLastBarSignalStrategy(symbol: string, lastBarTs: number): IStrategy {
  let evalCount = 0;
  return {
    id: 'last-bar-strat' as UUID,
    type: 'pairs_trading',
    config: {
      id: 'last-bar-strat' as UUID,
      name: 'Last bar signaller',
      type: 'pairs_trading',
      symbols: [symbol],
      rollingWindowMs: 60_000,
      maxPositionSizeUsd: 100_000,
      cooldownMs: 0,
      enabled: true,
    },
    start: () => { evalCount = 0; },
    stop: () => {},
    evaluate: (ctx): StrategySignal | null => {
      evalCount++;
      const bar = ctx.symbolState.get(symbol)?.latestBar;
      if (!bar || bar.ts !== lastBarTs) return null;
      return {
        id: 'sig-1' as UUID,
        strategyId: 'last-bar-strat',
        strategyType: 'pairs_trading',
        symbol,
        direction: 'long',
        qty: 1,
        triggerLabel: 'last-bar',
        ts: bar.ts,
      };
    },
  };
}

describe('BacktestEngine: terminal pending order cleanup', () => {
  it('an order generated on the final bar ends with terminal status, not "submitted"', async () => {
    const bars = [makeBar('SPY', 1_000, 100), makeBar('SPY', 2_000, 101), makeBar('SPY', 3_000, 102)];
    const engine = makeEngineWithBars(bars);

    const result = await engine.run(
      makeConfig({ slippageBps: 0, commissionPerShare: 0 }),
      () => [makeLastBarSignalStrategy('SPY', 3_000)],
    );

    expect(result.orders).toHaveLength(1);
    const order = result.orders![0];
    // Must NOT remain "submitted" — that was the bug.
    expect(order.status).not.toBe('submitted');
    // Acceptable terminal states for an IOC intent that never had a next-bar
    // open to fill at: expired (drained) or canceled.
    expect(['expired', 'canceled']).toContain(order.status);
  });

  it('terminal-drained orders do not affect equity (no phantom fill)', async () => {
    const bars = [makeBar('SPY', 1_000, 100), makeBar('SPY', 2_000, 101)];
    const engine = makeEngineWithBars(bars);

    const result = await engine.run(
      makeConfig({ slippageBps: 0, commissionPerShare: 0 }),
      () => [makeLastBarSignalStrategy('SPY', 2_000)],
    );

    // No fill ever occurred → equity stays at initialCapital throughout.
    expect(result.fills).toHaveLength(0);
    result.equity_curve.forEach((snap) => expect(snap.equity).toBe(100_000));
  });
});

// ------------------------------------------------------------------
// Simulated period timestamps
// ------------------------------------------------------------------

describe('run(): metrics.periodStart and metrics.periodEnd reflect simulated dates', () => {
  it('periodStart equals config.startDate parsed to epoch ms', async () => {
    const config = makeConfig({
      startDate: '2023-01-01T00:00:00Z',
      endDate:   '2023-12-31T23:59:59Z',
    });
    const result = await makeEngineWithBars([]).run(config, () => []);
    expect(result.metrics.periodStart).toBe(new Date('2023-01-01T00:00:00Z').getTime());
  });

  it('periodEnd equals config.endDate parsed to epoch ms', async () => {
    const config = makeConfig({
      startDate: '2023-01-01T00:00:00Z',
      endDate:   '2023-12-31T23:59:59Z',
    });
    const result = await makeEngineWithBars([]).run(config, () => []);
    expect(result.metrics.periodEnd).toBe(new Date('2023-12-31T23:59:59Z').getTime());
  });

  it('periodStart and periodEnd are the simulated period, not wall-clock (differ by ~1 year)', async () => {
    const config = makeConfig({
      startDate: '2023-01-01T00:00:00Z',
      endDate:   '2024-01-01T00:00:00Z',
    });
    const result = await makeEngineWithBars([]).run(config, () => []);
    const spanMs = result.metrics.periodEnd - result.metrics.periodStart;
    const oneYearMs = 365 * 24 * 3_600_000;
    // Simulated span is ~1 year; wall-clock run takes milliseconds.
    expect(spanMs).toBeGreaterThan(oneYearMs * 0.99);
    expect(spanMs).toBeLessThan(oneYearMs * 1.01);
  });
});

// ------------------------------------------------------------------
// sharpeConvention routing
// ------------------------------------------------------------------

const DAY_MS = 24 * 3_600_000;

/**
 * Produces a config whose strategyConfig carries the given sharpeConvention.
 * Bars are spaced 1 minute apart within a single UTC day so daily resampling
 * yields 0 daily return observations (< MIN_PERIODS_FOR_RATIOS). Only the
 * per-bar path can produce a defined Sharpe in this scenario.
 */
function makeIntradayConfig(sharpeConvention?: 'daily' | 'intraday'): BacktestConfig {
  const base = makeConfig();
  return {
    ...base,
    strategyConfig: {
      ...base.strategyConfig,
      ...(sharpeConvention !== undefined && { sharpeConvention }),
    },
  };
}

/**
 * Strategy that emits a buy signal on the first bar so subsequent bars mark
 * the position to market, creating equity variance across bars.
 */
function makeFirstBarBuyStrategy(symbol: string, firstBarTs: number): IStrategy {
  return {
    id: 'first-bar-strat' as UUID,
    type: 'pairs_trading',
    config: {
      id: 'first-bar-strat' as UUID,
      name: 'First bar buyer',
      type: 'pairs_trading',
      symbols: [symbol],
      rollingWindowMs: 60_000,
      maxPositionSizeUsd: 100_000,
      cooldownMs: 0,
      enabled: true,
    },
    start: () => {},
    stop: () => {},
    evaluate: (ctx): StrategySignal | null => {
      const bar = ctx.symbolState.get(symbol)?.latestBar;
      if (!bar || bar.ts !== firstBarTs) return null;
      return {
        id: 'sig-buy' as UUID,
        strategyId: 'first-bar-strat',
        strategyType: 'pairs_trading',
        symbol,
        direction: 'long',
        qty: 10,
        triggerLabel: 'first-bar',
        ts: bar.ts,
      };
    },
  };
}

describe('run(): sharpeConvention routing', () => {
  // Bars are spaced 1 minute apart within one UTC day.
  // Daily resampling → ≤ 1 daily observation → periodCount = 0 → no daily Sharpe.
  // Per-bar returns have variance from MTM price changes → per-bar Sharpe is defined.
  const BASE_TS = DAY_MS * 19_000; // arbitrary epoch anchored to a UTC day boundary
  const barPrices = [100, 101, 99, 102, 98, 103, 97, 104, 96, 105,
                     104, 103, 102, 101, 100, 101, 102, 103, 104, 105];
  const intradayBars = barPrices.map((price, i) =>
    makeBar('SPY', BASE_TS + i * 60_000, price),
  );

  it('no sharpeConvention → metrics.sharpeRatio is undefined when only 1 calendar day of data', async () => {
    const engine = makeEngineWithBars(intradayBars);
    const result = await engine.run(
      makeIntradayConfig(),
      () => [makeFirstBarBuyStrategy('SPY', BASE_TS)],
    );
    // < 4 daily observations → daily Sharpe undefined
    expect(result.metrics.sharpeRatio).toBeUndefined();
  });

  it('sharpeConvention "intraday" → metrics.sharpeRatio is defined from per-bar returns', async () => {
    const engine = makeEngineWithBars(intradayBars);
    const result = await engine.run(
      makeIntradayConfig('intraday'),
      () => [makeFirstBarBuyStrategy('SPY', BASE_TS)],
    );
    // Per-bar returns have variance → intraday Sharpe is defined
    expect(result.metrics.sharpeRatio).toBeDefined();
    expect(typeof result.metrics.sharpeRatio).toBe('number');
  });

  it('sharpeConvention "daily" behaves identically to omitting it', async () => {
    const engine1 = makeEngineWithBars(intradayBars);
    const engine2 = makeEngineWithBars(intradayBars);
    const [r1, r2] = await Promise.all([
      engine1.run(makeIntradayConfig('daily'), () => [makeFirstBarBuyStrategy('SPY', BASE_TS)]),
      engine2.run(makeIntradayConfig(),        () => [makeFirstBarBuyStrategy('SPY', BASE_TS)]),
    ]);
    expect(r1.metrics.sharpeRatio).toBe(r2.metrics.sharpeRatio);
    expect(r1.metrics.sortinoRatio).toBe(r2.metrics.sortinoRatio);
  });
});
