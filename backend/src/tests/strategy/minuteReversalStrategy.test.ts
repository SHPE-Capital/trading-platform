// Mock env — must be before any import that transitively touches config/env
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

jest.mock('../../utils/time', () => ({
  ...jest.requireActual('../../utils/time'),
  nowMs: jest.fn(),
}));

import { nowMs } from '../../utils/time';
import { MinuteReversalStrategy } from '../../strategies/minuteReversal/minuteReversalStrategy';
import { createMinuteReversalConfig } from '../../strategies/minuteReversal/minuteReversalConfig';
import { STRATEGY_FACTORY } from '../../config/strategyDefaults';
import { SymbolStateManager } from '../../core/state/symbolState';
import { PortfolioStateManager } from '../../core/state/portfolioState';
import { OrderStateManager } from '../../core/state/orderState';
import type { EvaluationContext } from '../../strategies/base/strategy';
import type { Bar } from '../../types/market';

const mockNowMs = nowMs as jest.Mock;

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 9, 6, 17, 0); // 13:00 ET

function bar(symbol: string, minute: number, close: number): Bar {
  const ts = T0 + minute * MINUTE;
  return {
    symbol, open: close, high: close, low: close, close, volume: 100,
    ts, isoTs: new Date(ts).toISOString(), timeframe: '1m',
  };
}

function setup(overrides = {}) {
  const strategy = new MinuteReversalStrategy(createMinuteReversalConfig({
    id: 'mr-1', symbols: ['NVDA', 'AAPL'], ...overrides,
  }));
  strategy.start();
  const symbolState = new SymbolStateManager();
  const portfolioState = new PortfolioStateManager(100_000);
  const orderState = new OrderStateManager();
  const context = (symbol: string): EvaluationContext => ({ symbol, symbolState, portfolioState, orderState });
  /** Delivers a bar the way the orchestrator does: state update, then evaluate. */
  const onBar = (b: Bar) => {
    symbolState.onBar(b);
    return strategy.evaluate(context(b.symbol));
  };
  const fill = (symbol: string, side: 'buy' | 'sell', qty: number) =>
    portfolioState.applyFill({
      id: `f-${symbol}-${side}`, orderId: 'o', symbol, side, qty, price: 100,
      notional: qty * 100, commission: 0, ts: T0, isoTs: new Date(T0).toISOString(),
    });
  return { strategy, symbolState, context, onBar, fill };
}

beforeEach(() => {
  mockNowMs.mockReturnValue(T0 + 10 * MINUTE);
});

describe('MinuteReversalStrategy', () => {
  it('uses the first bar as a baseline without trading', () => {
    const { onBar } = setup();
    expect(onBar(bar('NVDA', 0, 100))).toBeNull();
  });

  it('sells after an up bar and buys after a down bar', () => {
    const { onBar } = setup();
    onBar(bar('NVDA', 0, 100));

    const sell = onBar(bar('NVDA', 1, 101));
    expect(sell).toMatchObject({
      symbol: 'NVDA', direction: 'short', qty: 1, triggerLabel: 'minute_up_sell',
      meta: { prevClose: 100, close: 101, positionBefore: 0 },
    });

    const buy = onBar(bar('NVDA', 2, 100.5));
    expect(buy).toMatchObject({ symbol: 'NVDA', direction: 'long', qty: 1, triggerLabel: 'minute_down_buy' });
  });

  it('does nothing when the close is unchanged', () => {
    const { onBar } = setup();
    onBar(bar('NVDA', 0, 100));
    expect(onBar(bar('NVDA', 1, 100))).toBeNull();
  });

  it('decides once per bar even though quotes and trades re-evaluate it', () => {
    const { onBar, strategy, context } = setup();
    onBar(bar('NVDA', 0, 100));
    expect(onBar(bar('NVDA', 1, 101))).not.toBeNull();
    // A quote tick between bars re-runs evaluate against the same latest bar.
    expect(strategy.evaluate(context('NVDA'))).toBeNull();
    expect(strategy.evaluate(context('NVDA'))).toBeNull();
  });

  it('skips an order that would push the position past maxPositionQty', () => {
    const { onBar, fill } = setup({ maxPositionQty: 1 });
    fill('NVDA', 'sell', 1); // already short the cap
    onBar(bar('NVDA', 0, 100));
    expect(onBar(bar('NVDA', 1, 101))).toBeNull();
    // Moving back toward flat is still allowed, labelled as a cover.
    expect(onBar(bar('NVDA', 2, 100))).toMatchObject({ direction: 'close_short', qty: 1 });
  });

  it('labels a sell that reduces a long as close_long', () => {
    const { onBar, fill } = setup({ maxPositionQty: 2 });
    fill('NVDA', 'buy', 1);
    onBar(bar('NVDA', 0, 100));
    expect(onBar(bar('NVDA', 1, 101))).toMatchObject({ direction: 'close_long', meta: { positionBefore: 1 } });
  });

  it('re-baselines instead of trading across a gap longer than maxBarGapMs', () => {
    const { onBar } = setup({ maxBarGapMs: 3 * MINUTE });
    onBar(bar('NVDA', 0, 100));
    expect(onBar(bar('NVDA', 10, 120))).toBeNull(); // 10 minutes later: not "the previous minute"
    expect(onBar(bar('NVDA', 11, 119))).toMatchObject({ direction: 'long', meta: { prevClose: 120 } });
  });

  it('tracks each symbol against its own previous bar', () => {
    const { onBar } = setup();
    onBar(bar('NVDA', 0, 100));
    onBar(bar('AAPL', 0, 300));
    expect(onBar(bar('NVDA', 1, 99))).toMatchObject({ symbol: 'NVDA', direction: 'long' });
    expect(onBar(bar('AAPL', 1, 301))).toMatchObject({ symbol: 'AAPL', direction: 'short' });
  });

  it('ignores symbols outside its universe', () => {
    const { onBar } = setup();
    onBar(bar('TSLA', 0, 100));
    expect(onBar(bar('TSLA', 1, 101))).toBeNull();
  });

  describe('regular session', () => {
    const at = (symbol: string, isoUtc: string, close: number): Bar => {
      const ts = Date.parse(isoUtc);
      return { symbol, open: close, high: close, low: close, close, volume: 100, ts, isoTs: isoUtc, timeframe: '1m' };
    };

    it('uses pre-market bars as baselines and trades from the 09:30 bar', () => {
      const { onBar } = setup();
      expect(onBar(at('NVDA', '2026-10-06T13:28:00Z', 100))).toBeNull(); // 09:28 ET
      expect(onBar(at('NVDA', '2026-10-06T13:29:00Z', 101))).toBeNull(); // 09:29 ET, decided at the bell
      expect(onBar(at('NVDA', '2026-10-06T13:30:00Z', 102))).toMatchObject({ direction: 'short', meta: { prevClose: 101 } });
    });

    it('trades the 15:58 bar but not the 15:59 bar, which arrives after the close', () => {
      const { onBar } = setup({ maxPositionQty: 5 });
      onBar(at('NVDA', '2026-10-06T19:57:00Z', 100));
      expect(onBar(at('NVDA', '2026-10-06T19:58:00Z', 101))).not.toBeNull();
      expect(onBar(at('NVDA', '2026-10-06T19:59:00Z', 102))).toBeNull();
    });

    it('applies Eastern time across the DST change', () => {
      const { onBar } = setup();
      onBar(at('NVDA', '2026-12-07T14:29:00Z', 100)); // 09:29 EST
      expect(onBar(at('NVDA', '2026-12-07T14:30:00Z', 99))).toMatchObject({ direction: 'long' });
    });

    it('does not trade at weekends', () => {
      const { onBar } = setup();
      onBar(at('NVDA', '2026-10-10T15:00:00Z', 100)); // Saturday 11:00 ET
      expect(onBar(at('NVDA', '2026-10-10T15:01:00Z', 101))).toBeNull();
    });

    it('trades extended hours when regularHoursOnly is off', () => {
      const { onBar } = setup({ regularHoursOnly: false });
      onBar(at('NVDA', '2026-10-06T12:00:00Z', 100)); // 08:00 ET
      expect(onBar(at('NVDA', '2026-10-06T12:01:00Z', 101))).toMatchObject({ direction: 'short' });
    });
  });

  it('emits nothing while stopped', () => {
    const { onBar, strategy } = setup();
    onBar(bar('NVDA', 0, 100));
    strategy.stop();
    expect(onBar(bar('NVDA', 1, 101))).toBeNull();
  });

  describe('warmUp', () => {
    it('primes the latest complete bar so the first live bar can trade', () => {
      const { onBar, strategy } = setup();
      mockNowMs.mockReturnValue(T0 + 5 * MINUTE + 1_000); // 13:05:01
      const primed = strategy.warmUp([bar('NVDA', 3, 100), bar('NVDA', 4, 101), bar('AAPL', 4, 300)]);
      expect(primed).toBe(3);
      expect(onBar(bar('NVDA', 5, 102))).toMatchObject({ direction: 'short', meta: { prevClose: 101 } });
    });

    it('skips an in-progress bar so its final live version is not mistaken for a duplicate', () => {
      const { onBar, strategy } = setup();
      mockNowMs.mockReturnValue(T0 + 5 * MINUTE + 1_000); // the 13:05 bar is still forming
      strategy.warmUp([bar('NVDA', 4, 101), bar('NVDA', 5, 105)]);
      expect(onBar(bar('NVDA', 5, 99))).toMatchObject({ direction: 'long', meta: { prevClose: 101 } });
    });

    it('looks back far enough to find a bar within maxBarGapMs', () => {
      const { strategy } = setup({ maxBarGapMs: 5 * MINUTE });
      expect(strategy.warmUpLookbackMs()).toBe(5 * MINUTE);
    });
  });

  describe('config validation', () => {
    it.each([
      [{ symbols: [] }, /symbols must not be empty/],
      [{ symbols: ['NVDA', 'NVDA'] }, /unique/],
      [{ qtyPerTrade: 0.5 }, /qtyPerTrade/],
      [{ qtyPerTrade: 2, maxPositionQty: 1 }, /maxPositionQty/],
      [{ maxBarGapMs: 30_000 }, /maxBarGapMs/],
    ])('rejects %j', (overrides, message) => {
      expect(() => setup(overrides)).toThrow(message);
    });
  });

  it('is built by the factory from a saved config, with defaults filling omitted fields', () => {
    const strategy = STRATEGY_FACTORY.minute_reversal({ id: 'cfg-1', symbols: ['MU', 'SPCX'] });
    expect(strategy).toBeInstanceOf(MinuteReversalStrategy);
    expect(strategy.id).toBe('cfg-1');
    expect(strategy.version).toBe(MinuteReversalStrategy.VERSION);
    expect((strategy as MinuteReversalStrategy).reversalConfig).toMatchObject({
      symbols: ['MU', 'SPCX'], qtyPerTrade: 1, maxPositionQty: 1,
    });
  });
});
