/**
 * backtestMakerQuotesFillModel.test.ts — integration test verifying that
 * maker-quote signals (the routing path used by AvellanedaStoikovStrategy)
 * flow through the orchestrator -> simulated execution -> configurable fill
 * model and are correctly gated by per-leg limitPrice.
 *
 * This covers the new behavior unlocked by the modeling-depth fill model:
 * resting limit orders that don't cross the simulated touch price are
 * rejected rather than auto-filled.
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
    name: 'mm-fm',
    strategyConfig: {
      id: 'strat' as UUID,
      name: 'strat',
      type: 'market_making',
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

/**
 * Emits a single maker_quotes signal on the bar at `atTs` with the supplied
 * bid/ask leg prices and qty. Mirrors AvellanedaStoikovStrategy's signal
 * shape (meta.kind === "maker_quotes" with paired makerQuotes).
 */
function makeMakerQuoteStrategy(
  symbol: string,
  atTs: number,
  bidPrice: number,
  askPrice: number,
  qty: number,
): IStrategy {
  return {
    id: 'mm' as UUID,
    type: 'market_making',
    config: {
      id: 'mm' as UUID,
      name: 'mm',
      type: 'market_making',
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
        strategyId: 'mm',
        strategyType: 'market_making',
        symbol,
        direction: 'flat',
        qty: 0,
        triggerLabel: 'mm_quote',
        ts: bar.ts,
        meta: {
          kind: 'maker_quotes',
          timeInForce: 'day',
          makerQuotes: [
            { side: 'buy', price: bidPrice, qty },
            { side: 'sell', price: askPrice, qty },
          ],
        },
      };
    },
  };
}

beforeEach(() => {
  (BacktestLoader.prototype.streamBars as jest.Mock) = jest.fn();
});

describe('BacktestEngine + maker-quote signals + fill model', () => {
  it('fills both legs when bid/ask limits straddle the next-bar touch price', async () => {
    // Bar 1: signal emitted at close = 100. Bar 2 open = 100 → touch price
    // is 100 (no spread/slippage). Bid 100.10 ≥ 100, ask 99.90 ≤ 100, so
    // both legs cross and should fill.
    const bars: Bar[] = [
      makeBar('SPY', 1_000, 100),
      makeBar('SPY', 2_000, 100),
    ];
    (BacktestLoader.prototype.streamBars as jest.Mock).mockImplementation(async function*() { yield bars; });

    const cfg = makeConfig({
      slippageBps: 0,
      commissionPerShare: 0,
      fillModel: { halfSpreadBps: 0, slippageBps: 0, volumeParticipationCap: 1 },
    });
    const result = await new BacktestEngine().run(cfg, () => [
      makeMakerQuoteStrategy('SPY', 1_000, 100.1, 99.9, 10),
    ]);

    expect(result.orders).toHaveLength(2);
    expect(result.fills).toHaveLength(2);
    const sides = result.fills!.map((f) => f.side).sort();
    expect(sides).toEqual(['buy', 'sell']);
  });

  it('rejects only the leg whose limit does not cross the simulated touch price', async () => {
    // With halfSpreadBps = slippageBps = 0 the simulated touch price equals
    // the bar reference (100). A buy limit at 99.50 cannot cross (needs
    // fillPrice ≤ limit, but 100 > 99.50). A sell limit at 99.50 *does*
    // cross (needs fillPrice ≥ limit, and 100 ≥ 99.50).
    const bars: Bar[] = [
      makeBar('SPY', 1_000, 100),
      makeBar('SPY', 2_000, 100),
    ];
    (BacktestLoader.prototype.streamBars as jest.Mock).mockImplementation(async function*() { yield bars; });

    const cfg = makeConfig({
      slippageBps: 0,
      commissionPerShare: 0,
      fillModel: { halfSpreadBps: 0, slippageBps: 0, volumeParticipationCap: 1 },
    });
    const result = await new BacktestEngine().run(cfg, () => [
      // Bid below touch → buy rejected. Ask below touch → sell crosses and fills.
      makeMakerQuoteStrategy('SPY', 1_000, 99.5, 99.5, 10),
    ]);

    expect(result.orders).toHaveLength(2);
    const buyOrder = result.orders!.find((o) => o.side === 'buy')!;
    const sellOrder = result.orders!.find((o) => o.side === 'sell')!;
    expect(buyOrder.status).toBe('rejected');
    expect(sellOrder.status).toBe('filled');
    expect(result.fills).toHaveLength(1);
    expect(result.fills![0].side).toBe('sell');
  });

  it('rejects both legs when neither side crosses the simulated touch price', async () => {
    // With halfSpreadBps = 10 (10 bps), buy touch = 100 * 1.001 = 100.10,
    // sell touch = 100 * 0.999 = 99.90. A wide quote pair at bid=99.50 /
    // ask=100.50 leaves both legs unable to cross.
    const bars: Bar[] = [
      makeBar('SPY', 1_000, 100),
      makeBar('SPY', 2_000, 100),
    ];
    (BacktestLoader.prototype.streamBars as jest.Mock).mockImplementation(async function*() { yield bars; });

    const cfg = makeConfig({
      slippageBps: 0,
      commissionPerShare: 0,
      fillModel: { halfSpreadBps: 10, slippageBps: 0, volumeParticipationCap: 1 },
    });
    const result = await new BacktestEngine().run(cfg, () => [
      makeMakerQuoteStrategy('SPY', 1_000, 99.5, 100.5, 10),
    ]);

    expect(result.orders).toHaveLength(2);
    for (const o of result.orders!) {
      expect(o.status).toBe('rejected');
    }
    expect(result.fills).toHaveLength(0);
  });
});
