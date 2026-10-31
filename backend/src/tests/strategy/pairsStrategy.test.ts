// Mock env — must be before any import that transitively touches config/env
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

// Mock time utilities — must be before imports
jest.mock('../../utils/time', () => ({
  ...jest.requireActual('../../utils/time'),
  nowMs: jest.fn(),
}));

// Mock computeZScore so we control exactly which z-score the strategy sees
jest.mock('../../services/indicators/zscore', () => ({
  computeZScore: jest.fn(),
  computeZScoreFromStats: jest.fn(),
}));

import { nowMs } from '../../utils/time';
import { computeZScoreFromStats } from '../../services/indicators/zscore';
import { PairsStrategy } from '../../strategies/pairs/pairsStrategy';
import { createPairsConfig } from '../../strategies/pairs/pairsConfig';
import { SymbolStateManager } from '../../core/state/symbolState';
import { PortfolioStateManager } from '../../core/state/portfolioState';
import { OrderStateManager } from '../../core/state/orderState';
import type { EvaluationContext } from '../../strategies/base/strategy';
import type { PairsInternalState } from '../../strategies/pairs/pairsTypes';
import type { ZScoreResult } from '../../services/indicators/zscore';
import type { Bar } from '../../types/market';

const mockNowMs = nowMs as jest.Mock;
const mockZScore = computeZScoreFromStats as jest.Mock;

let currentTs = 1_000_000;

const testConfig = createPairsConfig('A', 'B', {
  minObservations: 5,
  entryZScore: 2,
  exitZScore: 0.5,
  stopLossZScore: 4,
  maxHoldingTimeMs: 60_000,
  cooldownMs: 5_000,
  fixedHedgeRatio: 1,
  tradeNotionalUsd: 5_000,
  rollingWindowMs: 3_600_000,
  olsWindowMs: 3_600_000,
  olsRecalcIntervalBars: 999,
});

function bar(symbol: string, close: number, ts = currentTs): Bar {
  return {
    symbol, open: close, high: close, low: close, close, volume: 1_000,
    ts, isoTs: new Date(ts).toISOString(), timeframe: '1Min',
  };
}

function contextFor(symbolState: SymbolStateManager, symbol = 'A'): EvaluationContext {
  return {
    symbol,
    symbolState,
    portfolioState: new PortfolioStateManager(100_000),
    orderState: new OrderStateManager(),
  };
}

/** Both legs' completed bars for the current minute, closing at the given prices. */
function makeContext(close1: number, close2: number): EvaluationContext {
  const symbolState = new SymbolStateManager();
  symbolState.onBar(bar('A', close1));
  symbolState.onBar(bar('B', close2));
  return contextFor(symbolState);
}

const NEUTRAL_Z: ZScoreResult = { zScore: 0, mean: 0, std: 0.1, value: 0 };
const ENTRY_LONG_Z: ZScoreResult = { zScore: -2.5, mean: 0, std: 0.1, value: -0.25 };
const ENTRY_SHORT_Z: ZScoreResult = { zScore: 2.5, mean: 0, std: 0.1, value: 0.25 };
const EXIT_Z: ZScoreResult = { zScore: 0.1, mean: 0, std: 0.1, value: 0.01 };
const STOP_LOSS_Z: ZScoreResult = { zScore: -4.5, mean: 0, std: 0.1, value: -0.45 };
const MAX_HOLD_Z: ZScoreResult = { zScore: 0.1, mean: 0, std: 0.1, value: 0.01 };

function makeStrategy(): PairsStrategy {
  const s = new PairsStrategy(testConfig);
  s.start();
  return s;
}

/** Push minObservations neutral ticks so the window is primed */
function warmUp(strategy: PairsStrategy): void {
  mockZScore.mockReturnValue(NEUTRAL_Z);
  for (let i = 0; i < testConfig.minObservations; i++) {
    currentTs += 1000;
    strategy.evaluate(makeContext(100, 100));
  }
}

/** Force the strategy into a position for exit testing */
function forcePosition(
  strategy: PairsStrategy,
  state: 'long_spread' | 'short_spread',
): void {
  const s = (strategy as unknown as { state: PairsInternalState }).state;
  s.positionState = state;
  s.positionOpenedAt = currentTs;
}

beforeEach(() => {
  currentTs = 1_000_000;
  mockNowMs.mockImplementation(() => currentTs);
  mockZScore.mockReturnValue(NEUTRAL_Z);
  jest.clearAllMocks();
  mockNowMs.mockImplementation(() => currentTs);
});

// ---------------------------------------------------------------------------
// Pre-entry: no signal
// ---------------------------------------------------------------------------
describe('pre-entry: no signal', () => {
  it('returns null when enabled is false', () => {
    const cfg = createPairsConfig('A', 'B', { ...testConfig, enabled: false });
    const strategy = new PairsStrategy(cfg);
    strategy.start();
    expect(strategy.evaluate(makeContext(100, 100))).toBeNull();
  });

  it('returns null when a symbol has no state', () => {
    const strategy = makeStrategy();
    // empty — no bars pushed
    expect(strategy.evaluate(contextFor(new SymbolStateManager()))).toBeNull();
  });

  it('returns null before minObservations are reached', () => {
    const strategy = makeStrategy();
    // Push 4 times (one less than minObservations=5)
    for (let i = 0; i < 4; i++) {
      currentTs += 1000;
      expect(strategy.evaluate(makeContext(100, 100))).toBeNull();
    }
  });

  it('returns null when z-score is within ±entryZScore', () => {
    const strategy = makeStrategy();
    warmUp(strategy);
    // z=0 is within [-2, +2] → no signal
    mockZScore.mockReturnValue(NEUTRAL_Z);
    currentTs += 1000;
    expect(strategy.evaluate(makeContext(100, 100))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sampling: one observation per minute in which both legs closed a bar
// ---------------------------------------------------------------------------
describe('bar sampling', () => {
  const observations = (strategy: PairsStrategy) =>
    (strategy as unknown as { state: PairsInternalState }).state.spreadWindow.size();

  it('triggers on bars only', () => {
    expect(makeStrategy().triggers).toEqual(['bar']);
  });

  it('scores a minute once its second bar arrives, whichever leg that is', () => {
    const strategy = makeStrategy();
    const state = new SymbolStateManager();
    state.onBar(bar('A', 100, currentTs - 60_000));
    state.onBar(bar('B', 100, currentTs - 60_000));
    strategy.evaluate(contextFor(state, 'A'));
    expect(observations(strategy)).toBe(1);

    // Leg 1's next bar arrives first: leg 2 is still a minute behind.
    state.onBar(bar('A', 101));
    strategy.evaluate(contextFor(state, 'A'));
    expect(observations(strategy)).toBe(1);

    state.onBar(bar('B', 99));
    strategy.evaluate(contextFor(state, 'B'));
    expect(observations(strategy)).toBe(2);
  });

  it('never scores the same minute twice', () => {
    const strategy = makeStrategy();
    const ctx = makeContext(100, 100);
    strategy.evaluate(ctx);
    strategy.evaluate(ctx);
    strategy.evaluate({ ...ctx, symbol: 'B' });
    expect(observations(strategy)).toBe(1);
  });

  it('prices each leg at its bar close, not a later quote', () => {
    const strategy = makeStrategy();
    const ctx = makeContext(100, 40);
    ctx.symbolState.onQuote({
      symbol: 'A', bidPrice: 109.99, askPrice: 110.01, bidSize: 100, askSize: 100,
      midPrice: 110, spread: 0.02, microPrice: 110, imbalance: 0,
      ts: currentTs + 1, isoTs: new Date(currentTs + 1).toISOString(),
    });
    strategy.evaluate(ctx);
    const s = (strategy as unknown as { state: PairsInternalState }).state;
    expect(s.lastSpread).toBe(60); // 100 - 1.0 × 40
  });

  it('ignores symbols outside the pair', () => {
    const strategy = makeStrategy();
    expect(strategy.evaluate({ ...makeContext(100, 100), symbol: 'C' })).toBeNull();
    expect(observations(strategy)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Entry signals
// ---------------------------------------------------------------------------
describe('entry signals', () => {
  it('z < -entryZScore → entry_long signal', () => {
    const strategy = makeStrategy();
    warmUp(strategy);

    mockZScore.mockReturnValueOnce(ENTRY_LONG_Z);
    currentTs += 1000;
    const signal = strategy.evaluate(makeContext(100, 100));

    expect(signal).not.toBeNull();
    expect(signal!.direction).toBe('long');
    const meta = signal!.meta as Record<string, unknown>;
    expect(meta.signalType).toBe('entry_long');
    expect(meta.counterpartDirection).toBe('short');
  });

  it('z < -entryZScore transitions positionState to long_spread', () => {
    const strategy = makeStrategy();
    warmUp(strategy);

    mockZScore.mockReturnValueOnce(ENTRY_LONG_Z);
    currentTs += 1000;
    strategy.evaluate(makeContext(100, 100));

    const s = (strategy as unknown as { state: PairsInternalState }).state;
    expect(s.positionState).toBe('long_spread');
  });

  it('z > +entryZScore → entry_short signal', () => {
    const strategy = makeStrategy();
    warmUp(strategy);

    mockZScore.mockReturnValueOnce(ENTRY_SHORT_Z);
    currentTs += 1000;
    const signal = strategy.evaluate(makeContext(100, 100));

    expect(signal).not.toBeNull();
    expect(signal!.direction).toBe('short');
    const meta = signal!.meta as Record<string, unknown>;
    expect(meta.signalType).toBe('entry_short');
    expect(meta.counterpartDirection).toBe('long');
  });

  it('no double-entry: second call at entry-level z while in long_spread returns null', () => {
    const strategy = makeStrategy();
    warmUp(strategy);

    // First call enters long_spread
    mockZScore.mockReturnValueOnce(ENTRY_LONG_Z);
    currentTs += 1000;
    strategy.evaluate(makeContext(100, 100));

    // Second call at entry-level z — should be null (already in position)
    mockZScore.mockReturnValueOnce(ENTRY_LONG_Z);
    currentTs += 1000;
    const secondSignal = strategy.evaluate(makeContext(100, 100));
    expect(secondSignal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Exit signals
// ---------------------------------------------------------------------------
describe('exit signals', () => {
  it('mean reversion exit: |z| < exitZScore while in long_spread', () => {
    const strategy = makeStrategy();
    warmUp(strategy);
    forcePosition(strategy, 'long_spread');

    mockZScore.mockReturnValueOnce(EXIT_Z); // |z|=0.1 < exitZScore=0.5
    currentTs += 1000;
    const signal = strategy.evaluate(makeContext(100, 100));

    expect(signal).not.toBeNull();
    const meta = signal!.meta as Record<string, unknown>;
    expect(meta.signalType).toBe('exit');
  });

  it('normal exit transitions positionState to flat and increments completedTrades', () => {
    const strategy = makeStrategy();
    warmUp(strategy);
    forcePosition(strategy, 'long_spread');

    mockZScore.mockReturnValueOnce(EXIT_Z);
    currentTs += 1000;
    strategy.evaluate(makeContext(100, 100));

    const s = (strategy as unknown as { state: PairsInternalState }).state;
    expect(s.positionState).toBe('flat');
    expect(s.completedTrades).toBe(1);
  });

  it('stop-loss exit: |z| >= stopLossZScore while in long_spread', () => {
    const strategy = makeStrategy();
    warmUp(strategy);
    forcePosition(strategy, 'long_spread');

    mockZScore.mockReturnValueOnce(STOP_LOSS_Z); // |z|=4.5 >= stopLossZScore=4
    currentTs += 1000;
    const signal = strategy.evaluate(makeContext(100, 100));

    expect(signal).not.toBeNull();
    const meta = signal!.meta as Record<string, unknown>;
    expect(meta.signalType).toBe('stop_loss');
  });

  it('max hold exit: positionOpenedAt + maxHoldingTimeMs exceeded', () => {
    const strategy = makeStrategy();
    warmUp(strategy);
    forcePosition(strategy, 'long_spread');

    // Set positionOpenedAt so the hold time is exceeded on next tick
    const s = (strategy as unknown as { state: PairsInternalState }).state;
    s.positionOpenedAt = currentTs - testConfig.maxHoldingTimeMs - 1;

    mockZScore.mockReturnValueOnce(MAX_HOLD_Z); // neutral z, so no stop-loss or normal exit
    currentTs += 1000;
    const signal = strategy.evaluate(makeContext(100, 100));

    expect(signal).not.toBeNull();
    const meta = signal!.meta as Record<string, unknown>;
    expect(meta.signalType).toBe('max_hold_exit');
  });

  describe('max hold is enforced even when scoring is skipped', () => {
    function overdueStrategy(): PairsStrategy {
      const strategy = makeStrategy();
      warmUp(strategy);
      forcePosition(strategy, 'long_spread');
      const s = (strategy as unknown as { state: PairsInternalState }).state;
      s.positionOpenedAt = currentTs - testConfig.maxHoldingTimeMs - 1;
      return strategy;
    }

    it('fires when only one leg printed a bar this minute', () => {
      const strategy = overdueStrategy();
      currentTs += 1000;
      const symbolState = new SymbolStateManager();
      symbolState.onBar(bar('A', 100)); // partner bar for this minute never arrives
      symbolState.onBar(bar('B', 100, currentTs - 60_000));

      const signal = strategy.evaluate(contextFor(symbolState));
      expect((signal!.meta as Record<string, unknown>).signalType).toBe('max_hold_exit');
    });

    it('fires when no z-score can be computed', () => {
      const strategy = overdueStrategy();
      mockZScore.mockReturnValue(null);
      currentTs += 1000;

      const signal = strategy.evaluate(makeContext(100, 100));
      expect((signal!.meta as Record<string, unknown>).signalType).toBe('max_hold_exit');
    });

    it('fires when the same minute is delivered twice', () => {
      const strategy = overdueStrategy();
      currentTs += 1000;
      const ctx = makeContext(100, 100);
      // First delivery: z between exit and stop-loss, position young, so it is simply held.
      mockZScore.mockReturnValueOnce({ zScore: 1, mean: 0, std: 0.1, value: 0.1 });
      const s = (strategy as unknown as { state: PairsInternalState }).state;
      s.positionOpenedAt = currentTs;
      expect(strategy.evaluate(ctx)).toBeNull();

      currentTs += testConfig.maxHoldingTimeMs + 1;
      const signal = strategy.evaluate(ctx); // repeat bar: scoring skips it
      expect((signal!.meta as Record<string, unknown>).signalType).toBe('max_hold_exit');
    });

    it('does not fire before the limit', () => {
      const strategy = makeStrategy();
      warmUp(strategy);
      forcePosition(strategy, 'long_spread');
      mockZScore.mockReturnValue(null);
      currentTs += 1000;
      expect(strategy.evaluate(makeContext(100, 100))).toBeNull();
    });
  });

  it('after any exit: cooldownActive is true and cooldownExpiresAt ≈ now + cooldownMs', () => {
    const strategy = makeStrategy();
    warmUp(strategy);
    forcePosition(strategy, 'long_spread');

    mockZScore.mockReturnValueOnce(EXIT_Z);
    const exitTs = currentTs + 1000;
    currentTs = exitTs;
    strategy.evaluate(makeContext(100, 100));

    const s = (strategy as unknown as { state: PairsInternalState }).state;
    expect(s.cooldownActive).toBe(true);
    expect(s.cooldownExpiresAt).toBe(exitTs + testConfig.cooldownMs);
  });
});

// ---------------------------------------------------------------------------
// Cooldown suppression
// ---------------------------------------------------------------------------
describe('cooldown suppression', () => {
  it('immediately after exit, evaluate returns null even at entry-level z', () => {
    const strategy = makeStrategy();
    warmUp(strategy);
    forcePosition(strategy, 'long_spread');

    // Generate exit to activate cooldown
    mockZScore.mockReturnValueOnce(EXIT_Z);
    currentTs += 1000;
    strategy.evaluate(makeContext(100, 100));

    // Within cooldown window: should return null
    mockZScore.mockReturnValueOnce(ENTRY_LONG_Z);
    currentTs += 100; // still within cooldownMs=5000
    const signal = strategy.evaluate(makeContext(100, 100));
    expect(signal).toBeNull();
  });

  it('after cooldown expires, a new entry signal fires', () => {
    const strategy = makeStrategy();
    warmUp(strategy);
    forcePosition(strategy, 'long_spread');

    // Exit at T → cooldownExpiresAt = T + 5000
    const exitTs = currentTs + 1000;
    currentTs = exitTs;
    mockZScore.mockReturnValueOnce(EXIT_Z);
    strategy.evaluate(makeContext(100, 100));

    const s = (strategy as unknown as { state: PairsInternalState }).state;
    const expiresAt = s.cooldownExpiresAt!;

    // Advance past cooldown
    currentTs = expiresAt + 1;
    mockNowMs.mockImplementation(() => currentTs);

    mockZScore.mockReturnValueOnce(ENTRY_LONG_Z);
    const signal = strategy.evaluate(makeContext(100, 100));
    expect(signal).not.toBeNull();
    const meta = signal!.meta as Record<string, unknown>;
    expect(meta.signalType).toBe('entry_long');
  });
});

// ---------------------------------------------------------------------------
// Bug 1: entry guard — never enter when z is already at or past stop-loss
// ---------------------------------------------------------------------------
describe('entry stop-loss guard (bug 1)', () => {
  it('z at exactly stopLossZScore → no entry signal', () => {
    const strategy = makeStrategy();
    warmUp(strategy);

    // z = stopLossZScore (4.0) — should be blocked
    const AT_STOP: ZScoreResult = { zScore: 4.0, mean: 0, std: 0.1, value: 0.4 };
    mockZScore.mockReturnValueOnce(AT_STOP);
    currentTs += 1000;
    expect(strategy.evaluate(makeContext(100, 100))).toBeNull();

    const s = (strategy as unknown as { state: PairsInternalState }).state;
    expect(s.positionState).toBe('flat');
  });

  it('z beyond stopLossZScore → no entry signal', () => {
    const strategy = makeStrategy();
    warmUp(strategy);

    const BEYOND: ZScoreResult = { zScore: -5.0, mean: 0, std: 0.1, value: -0.5 };
    mockZScore.mockReturnValueOnce(BEYOND);
    currentTs += 1000;
    expect(strategy.evaluate(makeContext(100, 100))).toBeNull();
  });

  it('z just inside entry range → entry fires normally', () => {
    const strategy = makeStrategy();
    warmUp(strategy);

    mockZScore.mockReturnValueOnce(ENTRY_LONG_Z); // z=-2.5, inside [-4, +4]
    currentTs += 1000;
    expect(strategy.evaluate(makeContext(100, 100))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Quantity sizing
// ---------------------------------------------------------------------------
describe('quantity sizing', () => {
  it('tradeNotionalUsd=5000, leg1 price $500 → qty=10', () => {
    const strategy = makeStrategy();
    warmUp(strategy);

    mockZScore.mockReturnValueOnce(ENTRY_LONG_Z);
    currentTs += 1000;
    const signal = strategy.evaluate(makeContext(500, 600)); // latestLeg1Price=500
    expect(signal!.qty).toBe(10); // floor(5000/500)
  });

  it('tradeNotionalUsd=5000, leg1 price $501 → qty=9 (floor rounding)', () => {
    const strategy = makeStrategy();
    warmUp(strategy);

    mockZScore.mockReturnValueOnce(ENTRY_LONG_Z);
    currentTs += 1000;
    const signal = strategy.evaluate(makeContext(501, 600));
    expect(signal!.qty).toBe(9); // floor(5000/501) = floor(9.98) = 9
  });

  it('leg1 price $0 → null signal (qty guard blocks entry, state stays flat)', () => {
    const strategy = makeStrategy();
    warmUp(strategy);

    mockZScore.mockReturnValueOnce(ENTRY_LONG_Z);
    currentTs += 1000;
    // price1=0 → _computeQty returns 0 → _buildEntrySignal returns null before state mutation
    const signal = strategy.evaluate(makeContext(0, 100));
    expect(signal).toBeNull();

    const s = (strategy as unknown as { state: PairsInternalState }).state;
    expect(s.positionState).toBe('flat');
  });

  it('tiny hedge ratio rounds leg2Qty to 0 → null signal, positionState stays flat', () => {
    const tinyHedgeCfg = createPairsConfig('A', 'B', {
      ...testConfig,
      fixedHedgeRatio: 0.001, // floor(10 * 0.001) = 0
    });
    const strategy = new PairsStrategy(tinyHedgeCfg);
    strategy.start();
    warmUp(strategy);

    mockZScore.mockReturnValueOnce(ENTRY_LONG_Z);
    currentTs += 1000;
    const signal = strategy.evaluate(makeContext(500, 500)); // leg1Qty=10, leg2Qty=floor(10*0.001)=0
    expect(signal).toBeNull();

    const s = (strategy as unknown as { state: PairsInternalState }).state;
    expect(s.positionState).toBe('flat');
  });
});
