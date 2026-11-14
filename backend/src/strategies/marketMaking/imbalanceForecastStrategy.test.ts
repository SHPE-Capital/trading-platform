/**
 * Tests for the Team 3 teaching strategy.
 *
 * HOW TO RUN
 *   cd backend
 *   npx jest src/tests/strategy/imbalanceForecastStrategy.test.ts
 *
 * HOW A STRATEGY TEST WORKS
 *   We build the same state objects the platform uses, feed in quotes we
 *   wrote by hand, call evaluate() ourselves, and check the answer.
 *   No internet, no Alpaca, no database: it runs in about a second.
 *
 *   The hand-made quotes are the Task 4 spreadsheet turned into code.
 */

// The platform reads environment settings on import; tests use fakes.
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
  ImbalanceForecastStrategy,
  imbalance,
  spreadTicks,
  isUsableQuote,
} from '../../strategies/imbalanceForecast/imbalanceForecastStrategy';
import { SymbolStateManager } from '../../core/state/symbolState';
import { PortfolioStateManager } from '../../core/state/portfolioState';
import { OrderStateManager } from '../../core/state/orderState';
import type { EvaluationContext } from '../../strategies/base/strategy';
import type { Quote } from '../../types/market';

const T0 = Date.UTC(2026, 9, 23, 14, 30); // Fri 10/23, 10:30 ET

/** Builds a quote from the four numbers we care about. `sec` = seconds after T0. */
function quote(sec: number, bid: number, ask: number, bidSize: number, askSize: number): Quote {
  const ts = T0 + sec * 1_000;
  return {
    symbol: 'SPY',
    bidPrice: bid,
    askPrice: ask,
    bidSize,
    askSize,
    midPrice: (bid + ask) / 2,
    spread: ask - bid,
    microPrice: (askSize * bid + bidSize * ask) / (bidSize + askSize),
    imbalance: (bidSize - askSize) / (bidSize + askSize),
    ts,
    isoTs: new Date(ts).toISOString(),
  };
}

/** A strategy plus the platform state it reads, wired together. */
function setup() {
  const strategy = new ImbalanceForecastStrategy({
    id: 'team3-test',
    name: 'Team 3 test',
    type: 'imbalance_forecast',
    symbols: ['SPY'],
    rollingWindowMs: 60_000,
    maxPositionSizeUsd: 10_000,
    cooldownMs: 0,
    enabled: true,
  });
  strategy.start();
  const symbolState = new SymbolStateManager();
  const portfolioState = new PortfolioStateManager(100_000);
  const orderState = new OrderStateManager();
  const context: EvaluationContext = { symbol: 'SPY', symbolState, portfolioState, orderState };

  /** What the platform does on each quote: update state, then call evaluate(). */
  const onQuote = (q: Quote) => {
    symbolState.onQuote(q);
    return strategy.evaluate(context);
  };
  /** Pretend an order filled, so the strategy sees a position. */
  const fill = (side: 'buy' | 'sell', qty: number, sec: number) =>
    portfolioState.applyFill({
      id: `f-${sec}`, orderId: 'o', symbol: 'SPY', side, qty, price: 580,
      notional: qty * 580, commission: 0, ts: T0 + sec * 1_000,
      isoTs: new Date(T0 + sec * 1_000).toISOString(),
    });
  return { strategy, onQuote, fill };
}

// ------------------------------------------------------------------
// 1. Features: hand-checked values (the spreadsheet)
// ------------------------------------------------------------------

describe('features', () => {
  it.each([
    // bid,    ask,    bidSize, askSize, expected imbalance, expected spreadTicks
    [580.00, 580.01, 8, 2, 0.6, 1],
    [580.00, 580.01, 2, 8, -0.6, 1],
    [580.00, 580.01, 5, 5, 0, 1],
    [580.00, 580.03, 9, 1, 0.8, 3],
  ])('bid %d ask %d sizes %d/%d → imbalance %d, spread %d ticks',
    (bid, ask, bs, as, expImb, expSpread) => {
      const q = quote(0, bid, ask, bs, as);
      expect(imbalance(q)).toBeCloseTo(expImb, 10);
      expect(spreadTicks(q)).toBe(expSpread);
    });

  it('rejects crossed quotes and zero sizes', () => {
    expect(isUsableQuote(quote(0, 580.01, 580.00, 5, 5))).toBe(false); // bid above ask
    expect(isUsableQuote(quote(0, 580.00, 580.00, 5, 5))).toBe(false); // locked
    expect(isUsableQuote(quote(0, 580.00, 580.01, 0, 5))).toBe(false); // empty bid
    expect(isUsableQuote(quote(0, 580.00, 580.01, 5, 5))).toBe(true);
  });
});

// ------------------------------------------------------------------
// 2. Decisions: does evaluate() do what the rule says?
// ------------------------------------------------------------------

describe('evaluate()', () => {
  it('goes long when buyers are heavier', () => {
    const { onQuote } = setup();
    const signal = onQuote(quote(0, 580.00, 580.01, 8, 2));
    expect(signal?.direction).toBe('long');
    expect(signal?.qty).toBe(1);
    expect(signal?.triggerLabel).toBe('bid_heavy');
  });

  it('goes short when sellers are heavier', () => {
    const { onQuote } = setup();
    expect(onQuote(quote(0, 580.00, 580.01, 2, 8))?.direction).toBe('short');
  });

  it('does nothing when the book is balanced', () => {
    const { onQuote } = setup();
    expect(onQuote(quote(0, 580.00, 580.01, 5, 5))).toBeNull();
  });

  it('sits out when the spread is too wide', () => {
    const { onQuote } = setup();
    expect(onQuote(quote(0, 580.00, 580.03, 9, 1))).toBeNull();
  });

  it('decides at most once per second', () => {
    const { onQuote } = setup();
    expect(onQuote(quote(0, 580.00, 580.01, 8, 2))).not.toBeNull();
    expect(onQuote(quote(0.5, 580.00, 580.01, 8, 2))).toBeNull(); // too soon
    expect(onQuote(quote(1, 580.00, 580.01, 8, 2))).not.toBeNull();
  });

  it('closes a long when sellers take over', () => {
    const { onQuote, fill } = setup();
    fill('buy', 1, 0);
    expect(onQuote(quote(1, 580.00, 580.01, 2, 8))?.direction).toBe('close_long');
  });

  it('closes after 60 seconds no matter what', () => {
    const { onQuote, fill } = setup();
    fill('buy', 1, 0);
    onQuote(quote(1, 580.00, 580.01, 5, 5));             // position noticed at 1 s
    const signal = onQuote(quote(61, 580.00, 580.01, 5, 5));
    expect(signal?.direction).toBe('close_long');
    expect(signal?.triggerLabel).toBe('time_exit');
  });

  it('does nothing before start()', () => {
    const { strategy, onQuote } = setup();
    strategy.stop();
    expect(onQuote(quote(0, 580.00, 580.01, 8, 2))).toBeNull();
  });
});
