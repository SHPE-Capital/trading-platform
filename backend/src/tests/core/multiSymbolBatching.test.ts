/**
 * multiSymbolBatching.test.ts
 *
 * Ensures the BacktestEngine processes all bars sharing a timestamp as a
 * single batch: state for ALL same-ts symbols is updated before strategies
 * evaluate, eliminating the cross-symbol same-ts lookahead asymmetry that
 * the alphabetical tiebreaker only partially mitigated.
 *
 * The test installs a synthetic strategy that, on every evaluation, records
 * the (symbol → latestBar.ts) snapshot it observes. Under the new
 * batching semantics, when the strategy is called for SPY at ts=N, QQQ's
 * latestBar.ts must also be N (not N-1). This is the regression invariant.
 *
 * Also asserts deterministic ordering when bars are shuffled at the same ts.
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
    maxPositionSizeUsd: 10_000,
    maxNotionalExposureUsd: 50_000,
    orderCooldownMs: 5_000,
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

function makeBar(symbol: string, ts: number, close = 100): Bar {
  return {
    symbol,
    open: close,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume: 10_000,
    ts,
    isoTs: new Date(ts).toISOString(),
    timeframe: '1Min',
  };
}

function makeConfig(symbols: string[]): BacktestConfig {
  return {
    id: 'bt' as UUID,
    name: 'multisymbol',
    strategyConfig: {
      id: 'strat' as UUID,
      name: 'strat',
      type: 'pairs_trading',
      symbols,
      rollingWindowMs: 60_000,
      maxPositionSizeUsd: 10_000,
      cooldownMs: 0,
      enabled: true,
    },
    startDate: '2024-01-01T00:00:00Z',
    endDate: '2024-01-02T00:00:00Z',
    initialCapital: 100_000,
    dataGranularity: 'bar',
    slippageBps: 0,
    commissionPerShare: 0,
  };
}

interface BatchObservation {
  forSymbol: string;
  observed: Record<string, number | null>;
}

/**
 * Strategy that records (per evaluation) the latestBar.ts it sees for every
 * symbol it watches. Returns no signals so it doesn't influence the run.
 */
function makeObservingStrategy(symbols: string[], observations: BatchObservation[]): IStrategy {
  return {
    id: 'obs' as UUID,
    type: 'pairs_trading',
    config: {
      id: 'obs' as UUID,
      name: 'obs',
      type: 'pairs_trading',
      symbols,
      rollingWindowMs: 60_000,
      maxPositionSizeUsd: 10_000,
      cooldownMs: 0,
      enabled: true,
    },
    start: () => {},
    stop: () => {},
    evaluate: (ctx) => {
      const obs: Record<string, number | null> = {};
      for (const sym of symbols) {
        obs[sym] = ctx.symbolState.get(sym)?.latestBar?.ts ?? null;
      }
      observations.push({ forSymbol: ctx.symbol, observed: obs });
      return null;
    },
  };
}

describe('BacktestEngine: multi-symbol timestamp batching', () => {
  beforeEach(() => {
    (BacktestLoader.prototype.streamBars as jest.Mock) = jest.fn();
  });

  it('strategies see ALL same-ts symbols updated before evaluation, regardless of ordering', async () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 5; i++) {
      bars.push(makeBar('SPY', 1_000 + i * 60_000, 100 + i));
      bars.push(makeBar('QQQ', 1_000 + i * 60_000, 300 + i));
    }
    (BacktestLoader.prototype.streamBars as jest.Mock).mockImplementation(async function*() { yield bars; });

    const observations: BatchObservation[] = [];
    const engine = new BacktestEngine();
    await engine.run(makeConfig(['SPY', 'QQQ']), () => [
      makeObservingStrategy(['SPY', 'QQQ'], observations),
    ]);

    // For every evaluation invocation, the latestBar.ts for SPY and QQQ must
    // be identical — i.e. both bars in the same ts batch must be applied to
    // symbol state BEFORE strategies are evaluated, regardless of which
    // symbol's BAR_RECEIVED is publishing.
    for (const o of observations) {
      expect(o.observed['SPY']).not.toBeNull();
      expect(o.observed['QQQ']).not.toBeNull();
      expect(o.observed['SPY']).toBe(o.observed['QQQ']);
    }
    expect(observations.length).toBeGreaterThan(0);
  });

  it('shuffled same-ts bars produce identical observed timestamps (deterministic batching)', async () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 3; i++) {
      bars.push(makeBar('SPY', 1_000 + i * 60_000, 100 + i));
      bars.push(makeBar('QQQ', 1_000 + i * 60_000, 300 + i));
    }
    // Shuffle deterministically: reverse the array. BacktestLoader sorts before
    // returning in practice; the engine must still batch correctly even if a
    // future loader change shuffled within a ts.
    const shuffled = [...bars].sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      // Reverse alphabetical to test invariance under intra-ts order.
      if (a.symbol < b.symbol) return 1;
      if (a.symbol > b.symbol) return -1;
      return 0;
    });
    (BacktestLoader.prototype.streamBars as jest.Mock).mockImplementation(async function*() { yield shuffled; });

    const observations: BatchObservation[] = [];
    const engine = new BacktestEngine();
    await engine.run(makeConfig(['SPY', 'QQQ']), () => [
      makeObservingStrategy(['SPY', 'QQQ'], observations),
    ]);

    for (const o of observations) {
      expect(o.observed['SPY']).toBe(o.observed['QQQ']);
    }
  });
});

describe('BacktestEngine: deterministic clock', () => {
  beforeEach(() => {
    (BacktestLoader.prototype.streamBars as jest.Mock) = jest.fn();
  });

  it('does not mutate Date.now globally and restores after the run', async () => {
    const bars = [makeBar('SPY', 1_000), makeBar('SPY', 2_000)];
    (BacktestLoader.prototype.streamBars as jest.Mock).mockImplementation(async function*() { yield bars; });

    const before = Date.now;
    await new BacktestEngine().run(makeConfig(['SPY']), () => []);
    expect(Date.now).toBe(before);
  });

  it('restores Date.now even if the run throws', async () => {
    const before = Date.now;
    (BacktestLoader.prototype.streamBars as jest.Mock).mockImplementation(async function*() { throw new Error('boom'); });
    await expect(new BacktestEngine().run(makeConfig(['SPY']), () => [])).rejects.toThrow('boom');
    expect(Date.now).toBe(before);
  });
});
