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

import { aggregateTradesToBar, groupTradesToBars } from '../../services/aggregations/ohlcv';
import type { Trade } from '../../types/market';

function makeTrade(price: number, size: number, ts: number): Trade {
  return {
    symbol: 'SPY',
    price,
    size,
    ts,
    isoTs: new Date(ts).toISOString(),
  };
}

describe('aggregateTradesToBar', () => {
  it('returns null for an empty trades array', () => {
    expect(aggregateTradesToBar([], 'SPY', 1_000, '1m')).toBeNull();
  });

  it('open equals the first trade price', () => {
    const bar = aggregateTradesToBar(
      [makeTrade(100, 10, 0), makeTrade(105, 5, 500)],
      'SPY', 0, '1m',
    )!;
    expect(bar.open).toBe(100);
  });

  it('close equals the last trade price', () => {
    const bar = aggregateTradesToBar(
      [makeTrade(100, 10, 0), makeTrade(95, 20, 500)],
      'SPY', 0, '1m',
    )!;
    expect(bar.close).toBe(95);
  });

  it('high equals the maximum trade price', () => {
    const bar = aggregateTradesToBar(
      [makeTrade(100, 10, 0), makeTrade(110, 5, 200), makeTrade(105, 8, 400)],
      'SPY', 0, '1m',
    )!;
    expect(bar.high).toBe(110);
  });

  it('low equals the minimum trade price', () => {
    const bar = aggregateTradesToBar(
      [makeTrade(100, 10, 0), makeTrade(92, 5, 200), makeTrade(98, 8, 400)],
      'SPY', 0, '1m',
    )!;
    expect(bar.low).toBe(92);
  });

  it('volume equals the sum of trade sizes', () => {
    const bar = aggregateTradesToBar(
      [makeTrade(100, 50, 0), makeTrade(105, 30, 200), makeTrade(98, 20, 400)],
      'SPY', 0, '1m',
    )!;
    expect(bar.volume).toBe(100);
  });

  it('computes size-weighted vwap correctly', () => {
    // trades: 100*50 + 105*30 + 98*20 = 5000 + 3150 + 1960 = 10110 / 100 = 101.1
    const bar = aggregateTradesToBar(
      [makeTrade(100, 50, 0), makeTrade(105, 30, 200), makeTrade(98, 20, 400)],
      'SPY', 0, '1m',
    )!;
    expect(bar.vwap).toBeCloseTo(101.1, 5);
  });

  it('tradeCount equals the number of trades', () => {
    const bar = aggregateTradesToBar(
      [makeTrade(100, 10, 0), makeTrade(101, 10, 1), makeTrade(99, 10, 2)],
      'SPY', 0, '1m',
    )!;
    expect(bar.tradeCount).toBe(3);
  });

  it('attaches the provided symbol, ts, and timeframe', () => {
    const bar = aggregateTradesToBar([makeTrade(100, 10, 0)], 'AAPL', 5_000, '5m')!;
    expect(bar.symbol).toBe('AAPL');
    expect(bar.ts).toBe(5_000);
    expect(bar.timeframe).toBe('5m');
  });
});

describe('groupTradesToBars', () => {
  const PERIOD_MS = 60_000; // 1 minute

  it('returns [] for empty trades', () => {
    expect(groupTradesToBars([], 'SPY', PERIOD_MS, '1m')).toEqual([]);
  });

  it('produces one bar when all trades fall in the same period', () => {
    const bars = groupTradesToBars(
      [makeTrade(100, 10, 1_000), makeTrade(101, 5, 30_000)],
      'SPY', PERIOD_MS, '1m',
    );
    expect(bars).toHaveLength(1);
    expect(bars[0].tradeCount).toBe(2);
  });

  it('splits trades into separate bars at period boundaries', () => {
    const bars = groupTradesToBars(
      [
        makeTrade(100, 10, 1_000),       // period: 0
        makeTrade(101, 5, 59_000),        // period: 0
        makeTrade(102, 8, 61_000),        // period: 60000
        makeTrade(103, 3, 90_000),        // period: 60000
      ],
      'SPY', PERIOD_MS, '1m',
    );
    expect(bars).toHaveLength(2);
    expect(bars[0].tradeCount).toBe(2);
    expect(bars[1].tradeCount).toBe(2);
  });

  it('bars are sorted by ts ascending', () => {
    const bars = groupTradesToBars(
      [makeTrade(100, 10, 1_000), makeTrade(101, 5, 61_000), makeTrade(102, 8, 121_000)],
      'SPY', PERIOD_MS, '1m',
    );
    expect(bars[0].ts).toBeLessThan(bars[1].ts);
    expect(bars[1].ts).toBeLessThan(bars[2].ts);
  });
});
