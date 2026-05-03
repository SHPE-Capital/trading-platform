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
}));

import { nowMs } from '../../utils/time';
import { computeZScore } from '../../services/indicators/zscore';
import { PairsStrategy } from '../../strategies/pairs/pairsStrategy';
import { createPairsConfig } from '../../strategies/pairs/pairsConfig';
import { SymbolStateManager } from '../../core/state/symbolState';
import { PortfolioStateManager } from '../../core/state/portfolioState';
import { OrderStateManager } from '../../core/state/orderState';
import type { EvaluationContext } from '../../strategies/base/strategy';
import type { PairsInternalState } from '../../strategies/pairs/pairsTypes';
import type { ZScoreResult } from '../../services/indicators/zscore';

const mockNowMs = nowMs as jest.Mock;
const mockZScore = computeZScore as jest.Mock;

let currentTs = 1_000_000;

const testConfig = createPairsConfig('A', 'B', {
  minObservations: 5,
  entryZScore: 2,
  exitZScore: 0.5,
  stopLossZScore: 4,
  maxHoldingTimeMs: 10_000,
  cooldownMs: 5_000,
  fixedHedgeRatio: 1,
  tradeNotionalUsd: 5_000,
  rollingWindowMs: 3_600_000,
  olsWindowMs: 3_600_000,
  olsRecalcIntervalBars: 999,
});

function makeContext(mid1: number, mid2: number): EvaluationContext {
  const symbolState = new SymbolStateManager();
  const isoTs = new Date(currentTs).toISOString();
  symbolState.onQuote({
    symbol: 'A', bidPrice: mid1 - 0.01, askPrice: mid1 + 0.01,
    bidSize: 100, askSize: 100, midPrice: mid1, spread: 0.02,
    microPrice: mid1, imbalance: 0, ts: currentTs, isoTs,
  });
  symbolState.onQuote({
    symbol: 'B', bidPrice: mid2 - 0.01, askPrice: mid2 + 0.01,
    bidSize: 100, askSize: 100, midPrice: mid2, spread: 0.02,
    microPrice: mid2, imbalance: 0, ts: currentTs, isoTs,
  });
  return {
    symbol: 'A',
    symbolState,
    portfolioState: new PortfolioStateManager(100_000),
    orderState: new OrderStateManager(),
  };
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

  it('returns null when context.symbol is leg2Symbol (only evaluates on leg1 bar)', () => {
    const strategy = makeStrategy();
    const ctx: EvaluationContext = {
      ...makeContext(100, 100),
      symbol: 'B', // leg2 — should be ignored
    };
    expect(strategy.evaluate(ctx)).toBeNull();
  });

  it('returns null when a symbol has no state', () => {
    const strategy = makeStrategy();
    const ctx: EvaluationContext = {
      symbol: 'A',
      symbolState: new SymbolStateManager(), // empty — no quotes pushed
      portfolioState: new PortfolioStateManager(100_000),
      orderState: new OrderStateManager(),
    };
    expect(strategy.evaluate(ctx)).toBeNull();
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

  it('leg1 price $0 → qty=0 (divide-by-zero guard)', () => {
    const strategy = makeStrategy();
    warmUp(strategy);

    mockZScore.mockReturnValueOnce(ENTRY_LONG_Z);
    currentTs += 1000;
    // price1=0 → latestLeg1Price=0 → _computeQty guard returns 0
    const signal = strategy.evaluate(makeContext(0, 100));
    expect(signal!.qty).toBe(0);
  });
});
