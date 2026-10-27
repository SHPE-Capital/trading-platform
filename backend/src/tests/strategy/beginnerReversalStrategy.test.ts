jest.mock('../../config/env', () => ({
  env: {
    alpacaApiKey: 'test-key',
    alpacaApiSecret: 'test-secret',
    alpacaTradingMode: 'paper',
    supabaseUrl: 'https://test.supabase.co',
    supabaseAnonKey: 'test-anon',
    supabaseServiceRoleKey: 'test-service',
    port: 8080,
    nodeEnv: 'test',
    logLevel: 'error',
    defaultRollingWindowMs: 60_000,
    maxPositionSizeUsd: 10_000,
    maxNotionalExposureUsd: 50_000,
    orderCooldownMs: 5_000,
    databaseUrl: '',
  },
}));

import {
  BeginnerReversalStrategy,
  createBeginnerReversalConfig,
} from '../../strategies/beginnerReversal/beginnerReversalStrategy';
import { STRATEGY_FACTORY, STRATEGY_DEFINITIONS, configProblem } from '../../config/strategyDefaults';
import { logger } from '../../utils/logger';
import { SymbolStateManager } from '../../core/state/symbolState';
import { PortfolioStateManager } from '../../core/state/portfolioState';
import { OrderStateManager } from '../../core/state/orderState';
import type { EvaluationContext } from '../../strategies/base/strategy';
import type { Bar } from '../../types/market';

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 9, 6, 17, 0);

function bar(symbol: string, minute: number, close: number): Bar {
  const ts = T0 + minute * MINUTE;
  return {
    symbol, open: close, high: close, low: close, close, volume: 100,
    ts, isoTs: new Date(ts).toISOString(), timeframe: '1m',
  };
}

function setup(overrides = {}) {
  const strategy = new BeginnerReversalStrategy(createBeginnerReversalConfig({
    id: 'br-1', symbols: ['SPY', 'AAPL'], ...overrides,
  }));
  strategy.start();
  const symbolState = new SymbolStateManager();
  const portfolioState = new PortfolioStateManager(100_000);
  const orderState = new OrderStateManager();
  const context = (symbol: string): EvaluationContext => ({ symbol, symbolState, portfolioState, orderState });
  const onBar = (b: Bar) => {
    symbolState.onBar(b);
    return strategy.evaluate(context(b.symbol));
  };
  const fill = (symbol: string, side: 'buy' | 'sell', qty: number) =>
    portfolioState.applyFill({
      id: `f-${symbol}-${side}`, orderId: 'o', symbol, side, qty, price: 100,
      notional: qty * 100, commission: 0, ts: T0, isoTs: new Date(T0).toISOString(),
    });
  return { strategy, context, onBar, fill };
}

describe('BeginnerReversalStrategy', () => {
  it('uses the first bar as a baseline without trading', () => {
    const { onBar } = setup();
    expect(onBar(bar('SPY', 0, 100))).toBeNull();
  });

  it('sells after an up bar and buys after a down bar', () => {
    const { onBar } = setup();
    onBar(bar('SPY', 0, 100));
    expect(onBar(bar('SPY', 1, 101))).toMatchObject({
      symbol: 'SPY', direction: 'short', qty: 1, triggerLabel: 'bar_up_sell',
      meta: { prevClose: 100, close: 101, positionBefore: 0 },
    });
    expect(onBar(bar('SPY', 2, 100.5))).toMatchObject({
      symbol: 'SPY', direction: 'long', qty: 1, triggerLabel: 'bar_down_buy',
    });
  });

  it('does nothing when the close is unchanged', () => {
    const { onBar } = setup();
    onBar(bar('SPY', 0, 100));
    expect(onBar(bar('SPY', 1, 100))).toBeNull();
  });

  it('decides once per bar even though quotes and trades re-evaluate it', () => {
    const { onBar, strategy, context } = setup();
    onBar(bar('SPY', 0, 100));
    expect(onBar(bar('SPY', 1, 101))).not.toBeNull();
    expect(strategy.evaluate(context('SPY'))).toBeNull();
  });

  it('tracks each symbol against its own previous bar', () => {
    const { onBar } = setup();
    onBar(bar('SPY', 0, 100));
    onBar(bar('AAPL', 0, 200));
    expect(onBar(bar('AAPL', 1, 199))).toMatchObject({ symbol: 'AAPL', direction: 'long' });
  });

  it('ignores symbols outside its config', () => {
    const { onBar } = setup();
    onBar(bar('TSLA', 0, 100));
    expect(onBar(bar('TSLA', 1, 101))).toBeNull();
  });

  it('skips an order past maxPositionQty but still allows moving back toward flat', () => {
    const { onBar, fill } = setup({ maxPositionQty: 1 });
    fill('SPY', 'sell', 1);
    onBar(bar('SPY', 0, 100));
    expect(onBar(bar('SPY', 1, 101))).toBeNull();
    expect(onBar(bar('SPY', 2, 100))).toMatchObject({ direction: 'close_short', qty: 1 });
  });

  it('says why it skipped a trade when the position cap is used up', () => {
    const info = jest.spyOn(logger, 'info').mockImplementation(() => {});
    const { onBar, fill } = setup({ maxPositionQty: 1 });
    fill('SPY', 'sell', 1);
    onBar(bar('SPY', 0, 100));
    expect(onBar(bar('SPY', 1, 101))).toBeNull();
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/SPY wanted to sell 1 .* cap of 1. Skipped/));
    info.mockRestore();
  });

  it('caps long positions and sells to close a long after an up bar', () => {
    const { onBar, fill } = setup({ maxPositionQty: 1 });
    fill('SPY', 'buy', 1);
    onBar(bar('SPY', 0, 100));
    expect(onBar(bar('SPY', 1, 99))).toBeNull();
    expect(onBar(bar('SPY', 2, 100))).toMatchObject({ direction: 'close_long', qty: 1 });
  });

  it('emits no signals when disabled even after being started', () => {
    const { onBar } = setup({ enabled: false });
    expect(onBar(bar('SPY', 0, 100))).toBeNull();
    expect(onBar(bar('SPY', 1, 99))).toBeNull();
    expect(onBar(bar('SPY', 2, 101))).toBeNull();
  });

  it('stays silent until started', () => {
    const strategy = new BeginnerReversalStrategy(createBeginnerReversalConfig({ symbols: ['SPY'] }));
    const symbolState = new SymbolStateManager();
    symbolState.onBar(bar('SPY', 0, 100));
    expect(strategy.evaluate({
      symbol: 'SPY', symbolState, portfolioState: new PortfolioStateManager(1), orderState: new OrderStateManager(),
    })).toBeNull();
  });

  it('asks to be called on bars only', () => {
    expect(setup().strategy.triggers).toEqual(['bar']);
  });

  it('rejects configs it cannot trade safely', () => {
    expect(() => new BeginnerReversalStrategy(createBeginnerReversalConfig({ symbols: [] }))).toThrow(/symbols/);
    expect(() => new BeginnerReversalStrategy(createBeginnerReversalConfig({ qtyPerTrade: 0 }))).toThrow(/qtyPerTrade/);
    expect(() => new BeginnerReversalStrategy(createBeginnerReversalConfig({ qtyPerTrade: 2, maxPositionQty: 1 })))
      .toThrow(/maxPositionQty/);
  });
});

describe('beginner_reversal save-time validation', () => {
  it('accepts a partial config because defaults fill the rest', () => {
    expect(configProblem('beginner_reversal', { symbols: ['SPY'] })).toBeNull();
    expect(configProblem('beginner_reversal', {})).toBeNull();
  });

  it.each([
    [{ qtyPerTrade: 0 }, /qtyPerTrade/],
    [{ qtyPerTrade: 1.5 }, /qtyPerTrade/],
    [{ qtyPerTrade: 2, maxPositionQty: 1 }, /maxPositionQty/],
    [{ symbols: [] }, /symbols/],
    [{ symbols: 'SPY, AAPL' }, /symbols/],
    [{ symbols: ['SPY', ' '] }, /ticker/],
  ])('reports %j', (config, message) => {
    expect(configProblem('beginner_reversal', config)).toMatch(message);
  });

  it('checks minute_reversal with its own validator and leaves pairs_trading unchecked', () => {
    expect(configProblem('minute_reversal', { qtyPerTrade: 0 })).toMatch(/qtyPerTrade/);
    expect(configProblem('pairs_trading', {})).toBeNull();
    expect(configProblem('no_such_type', {})).toBeNull();
  });
});

describe('beginner_reversal registration', () => {
  it('builds from a partial saved config, filling defaults', () => {
    const strategy = STRATEGY_FACTORY.beginner_reversal({ id: 'cfg-9', symbols: ['SPY'] });
    expect(strategy).toBeInstanceOf(BeginnerReversalStrategy);
    expect(strategy.config).toMatchObject({ id: 'cfg-9', symbols: ['SPY'], qtyPerTrade: 1 });
  });

  it('is described by the class version, and every param key exists in its default config', () => {
    const def = STRATEGY_DEFINITIONS.beginner_reversal;
    expect(def.algorithmVersion).toBe(BeginnerReversalStrategy.VERSION);
    for (const param of def.params ?? []) expect(def.defaultConfig).toHaveProperty(param.key);
  });
});
