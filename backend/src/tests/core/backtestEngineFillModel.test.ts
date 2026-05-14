/**
 * backtestEngineFillModel.test.ts — verifies that the new fill model + result
 * metadata is wired correctly into the BacktestEngine.
 */

jest.mock('../../config/env', () => ({
  env: {
    alpacaApiKey: 'k',
    alpacaApiSecret: 's',
    alpacaTradingMode: 'paper',
    alpacaPaperBaseUrl: '',
    alpacaLiveBaseUrl: '',
    alpacaDataStreamUrl: '',
    alpacaPaperStreamUrl: '',
    alpacaLiveStreamUrl: '',
    supabaseUrl: '',
    supabaseAnonKey: '',
    supabaseServiceRoleKey: '',
    port: 8080,
    nodeEnv: 'test',
    corsOrigin: '',
    logLevel: 'error',
    defaultRollingWindowMs: 60_000,
    maxPositionSizeUsd: 1_000_000_000,
    maxNotionalExposureUsd: 1_000_000_000,
    orderCooldownMs: 0,
    enableLiveTrading: false,
    enableWebSocketPush: false,
    databaseUrl: '',
  },
}));

jest.mock('../../core/backtest/backtestLoader');

import { BacktestEngine } from '../../core/backtest/backtestEngine';
import { BacktestLoader } from '../../core/backtest/backtestLoader';
import type { Bar } from '../../types/market';
import type { BacktestConfig } from '../../types/backtest';
import type { IStrategy } from '../../strategies/base/strategy';
import type { UUID } from '../../types/common';
import type { StrategySignal } from '../../types/strategy';

function makeBar(symbol: string, ts: number, close: number, volume = 100_000): Bar {
  return {
    symbol,
    open: close,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume,
    ts,
    isoTs: new Date(ts).toISOString(),
    timeframe: '1Min',
  };
}

function makeConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    id: 'bt' as UUID,
    name: 'fm',
    strategyConfig: {
      id: 'strat' as UUID,
      name: 'strat',
      type: 'pairs_trading',
      symbols: ['SPY'],
      rollingWindowMs: 60_000,
      maxPositionSizeUsd: 1_000_000_000,
      cooldownMs: 0,
      enabled: true,
    },
    startDate: '2024-01-01T00:00:00Z',
    endDate: '2024-01-02T00:00:00Z',
    initialCapital: 1_000_000,
    dataGranularity: 'bar',
    slippageBps: 0,
    commissionPerShare: 0,
    ...overrides,
  };
}

function makeBuyStrategy(symbol: string, atTs: number, qty: number): IStrategy {
  return {
    id: 'buy' as UUID,
    type: 'pairs_trading',
    config: {
      id: 'buy' as UUID,
      name: 'buy',
      type: 'pairs_trading',
      symbols: [symbol],
      rollingWindowMs: 60_000,
      maxPositionSizeUsd: 1_000_000_000,
      cooldownMs: 0,
      enabled: true,
    },
    start: () => {},
    stop: () => {},
    evaluate: (ctx): StrategySignal | null => {
      const bar = ctx.symbolState.get(symbol)?.latestBar;
      if (!bar || bar.ts !== atTs) return null;
      return {
        id: 'sig' as UUID,
        strategyId: 'buy',
        strategyType: 'pairs_trading',
        symbol,
        direction: 'long',
        qty,
        triggerLabel: 'test',
        ts: bar.ts,
      };
    },
  };
}

beforeEach(() => {
  (BacktestLoader.prototype.loadBars as jest.Mock) = jest.fn();
});

describe('BacktestEngine + fill model', () => {
  it('exposes the effective fill model in the result metadata', async () => {
    (BacktestLoader.prototype.loadBars as jest.Mock).mockResolvedValue([
      makeBar('SPY', 1_000, 100),
      makeBar('SPY', 2_000, 101),
    ]);
    const cfg = makeConfig({
      slippageBps: 5,
      commissionPerShare: 0.005,
      fillModel: { halfSpreadBps: 3, volumeParticipationCap: 0.05 },
    });
    const result = await new BacktestEngine().run(cfg, () => []);
    expect(result.fill_model).toBeDefined();
    expect(result.fill_model!.halfSpreadBps).toBe(3);
    expect(result.fill_model!.slippageBps).toBe(5);
    expect(result.fill_model!.volumeParticipationCap).toBe(0.05);
    expect(result.fill_model!.commissionPerShare).toBe(0.005);
  });

  it('partially fills a market buy that exceeds the volume participation cap', async () => {
    // Use a low price so 500 shares stays inside the default $10k risk limit.
    const bars: Bar[] = [
      makeBar('SPY', 1_000, 1, 1_000),
      makeBar('SPY', 2_000, 1, 1_000),
    ];
    (BacktestLoader.prototype.loadBars as jest.Mock).mockResolvedValue(bars);

    // Request 500 shares with a 10% participation cap on a 1_000-volume bar
    // → only 100 fills, the remainder expires (IOC).
    const cfg = makeConfig({
      slippageBps: 0,
      commissionPerShare: 0,
      fillModel: { halfSpreadBps: 0, volumeParticipationCap: 0.1, allowPartialFills: true },
    });
    const result = await new BacktestEngine().run(cfg, () => [
      makeBuyStrategy('SPY', 1_000, 500),
    ]);

    expect(result.fills).toHaveLength(1);
    expect(result.fills![0].qty).toBe(100);
    expect(result.orders).toHaveLength(1);
    expect(['expired', 'partial_fill', 'canceled', 'filled']).toContain(result.orders![0].status);
  });

  it('rejects a market buy when bar volume is zero (halt bar)', async () => {
    const bars: Bar[] = [
      makeBar('SPY', 1_000, 1, 1_000),
      makeBar('SPY', 2_000, 1, 0),
    ];
    (BacktestLoader.prototype.loadBars as jest.Mock).mockResolvedValue(bars);

    const cfg = makeConfig({
      slippageBps: 0,
      commissionPerShare: 0,
      fillModel: { halfSpreadBps: 0, volumeParticipationCap: 0.1 },
    });
    const result = await new BacktestEngine().run(cfg, () => [
      makeBuyStrategy('SPY', 1_000, 10),
    ]);
    expect(result.fills).toHaveLength(0);
    expect(result.orders).toHaveLength(1);
    expect(result.orders![0].status).toBe('rejected');
  });
});

describe('BacktestEngine result metadata: data validation + assumptions', () => {
  it('exposes data_validation issues and metadata in the result', async () => {
    (BacktestLoader.prototype.loadBars as jest.Mock).mockResolvedValue([
      makeBar('SPY', 1_000, 100),
      makeBar('SPY', 2_000, 100),
      // Out-of-order bar — gets dropped, surfaces an error issue.
      makeBar('SPY', 1_500, 100),
    ]);
    const cfg = makeConfig();
    const result = await new BacktestEngine().run(cfg, () => []);
    expect(result.data_validation).toBeDefined();
    expect(result.data_validation!.metadata.invalidBarsDropped).toBeGreaterThan(0);
    expect(result.data_validation!.issues.length).toBeGreaterThan(0);
  });

  it('aborts when strictDataValidation is true and errors are present', async () => {
    (BacktestLoader.prototype.loadBars as jest.Mock).mockResolvedValue([
      makeBar('SPY', 1_000, 100),
      makeBar('SPY', 2_000, 100),
      makeBar('SPY', 1_500, 100), // out of order
    ]);
    const cfg = makeConfig({ strictDataValidation: true });
    await expect(new BacktestEngine().run(cfg, () => [])).rejects.toThrow(/validation/i);
  });

  it('flags insufficientReturnsForRatios when curve is too short for Sharpe/Sortino', async () => {
    (BacktestLoader.prototype.loadBars as jest.Mock).mockResolvedValue([
      makeBar('SPY', 1_000, 100),
      makeBar('SPY', 2_000, 100),
    ]);
    const cfg = makeConfig();
    const result = await new BacktestEngine().run(cfg, () => []);
    expect(result.assumptions).toBeDefined();
    expect(result.assumptions!.insufficientReturnsForRatios).toBe(true);
    expect(result.metrics.sharpeRatio).toBeUndefined();
  });

  it('reports benchmarkProvided=true when benchmarkCurve is supplied', async () => {
    (BacktestLoader.prototype.loadBars as jest.Mock).mockResolvedValue([
      makeBar('SPY', 1_000, 100),
      makeBar('SPY', 2_000, 100),
    ]);
    const cfg = makeConfig({
      benchmarkCurve: [
        { ts: 1_000, value: 100 },
        { ts: 2_000, value: 110 },
      ],
    });
    const result = await new BacktestEngine().run(cfg, () => []);
    expect(result.assumptions!.benchmarkProvided).toBe(true);
    expect(result.metrics.meta!.benchmarkReturn).toBeCloseTo(0.1, 6);
  });
});
