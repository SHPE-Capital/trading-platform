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
  it('returns status=completed with empty equity curve when there are no bars', async () => {
    const engine = makeEngineWithBars([]);
    const result = await engine.run(makeConfig(), () => []);
    expect(result.status).toBe('completed');
    expect(result.equity_curve).toHaveLength(0);
    expect(result.fills).toHaveLength(0);
    expect(result.orders).toHaveLength(0);
    expect(result.event_count).toBe(0);
    expect(result.metrics.totalReturn).toBe(0);
  });

  it('equity curve has one snapshot per bar plus final MTM when no strategy is registered', async () => {
    const bars = [makeBar('SPY', 1_000), makeBar('SPY', 2_000), makeBar('SPY', 3_000)];
    const engine = makeEngineWithBars(bars);
    const result = await engine.run(makeConfig(), () => []);
    // 3 bars + 1 final MTM snapshot
    expect(result.equity_curve).toHaveLength(4);
    expect(result.event_count).toBe(3);
  });

  it('all equity snapshots start at initialCapital when no trades are placed', async () => {
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
});

describe('_computeMetrics', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let computeMetrics: (curve: PortfolioSnapshot[], fills: Fill[], initial: number, start: number, end: number) => any;

  beforeEach(() => {
    const engine = new BacktestEngine();
    computeMetrics = (engine as unknown as {
      _computeMetrics: typeof computeMetrics
    })._computeMetrics.bind(engine);
  });

  it('empty equity curve returns all-zero metrics', () => {
    const m = computeMetrics([], [], 100_000, 0, 100);
    expect(m.totalReturn).toBe(0);
    expect(m.totalReturnPct).toBe(0);
    expect(m.maxDrawdown).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.totalTrades).toBe(0);
  });

  it('computes totalReturn and totalReturnPct correctly', () => {
    const curve = [makeSnap(110_000)];
    const m = computeMetrics(curve, [], 100_000, 0, 1);
    expect(m.totalReturn).toBe(10_000);
    expect(m.totalReturnPct).toBeCloseTo(0.1, 5);
  });

  it('computes maxDrawdown across equity curve', () => {
    // Peak at 110k, drops to 90k → drawdown = 20k/110k ≈ 18.18%
    const curve = [makeSnap(110_000), makeSnap(90_000), makeSnap(95_000)];
    const m = computeMetrics(curve, [], 100_000, 0, 1);
    expect(m.maxDrawdown).toBeCloseTo(20_000 / 110_000, 4);
  });

  it('no drawdown when equity only increases', () => {
    const curve = [makeSnap(100_000), makeSnap(105_000), makeSnap(110_000)];
    const m = computeMetrics(curve, [], 100_000, 0, 1);
    expect(m.maxDrawdown).toBe(0);
  });

  it('computes winRate, avgWin, avgLoss from paired fills', () => {
    const fills = [
      makeFill('SPY', 'buy', 10, 100),   // buy at 100
      makeFill('SPY', 'sell', 10, 110),  // sell at 110 → pnl = 100
      makeFill('AAPL', 'buy', 5, 200),   // buy at 200
      makeFill('AAPL', 'sell', 5, 180),  // sell at 180 → pnl = -100
    ];
    const m = computeMetrics([makeSnap(100_000)], fills, 100_000, 0, 1);
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
    const m = computeMetrics([makeSnap(102_000)], fills, 100_000, 0, 1);
    expect(m.winRate).toBe(1);
    expect(m.totalTrades).toBe(1);
  });
});
