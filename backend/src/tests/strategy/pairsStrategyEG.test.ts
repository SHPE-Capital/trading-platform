// Mock env — must precede any import that touches config/env
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

jest.mock('../../utils/time', () => ({
  ...jest.requireActual('../../utils/time'),
  nowMs: jest.fn(),
}));

// Mock computeZScore so gate tests can inject any z-score they need.
// computeEngleGranger is NOT mocked — it is tested directly in indicator tests.
jest.mock('../../services/indicators/zscore', () => ({
  computeZScore: jest.fn(),
}));

import { nowMs } from '../../utils/time';
import { computeZScore } from '../../services/indicators/zscore';
import { computeEngleGranger } from '../../services/indicators/cointegration';
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

const NEUTRAL_Z: ZScoreResult = { zScore: 0, mean: 0, std: 0.1, value: 0 };
const ENTRY_SHORT_Z: ZScoreResult = { zScore: 2.5, mean: 0, std: 0.1, value: 0.25 };

beforeEach(() => {
  currentTs = 1_000_000;
  mockNowMs.mockImplementation(() => currentTs);
  mockZScore.mockReturnValue(NEUTRAL_Z);
  jest.clearAllMocks();
  mockNowMs.mockImplementation(() => currentTs);
  mockZScore.mockReturnValue(NEUTRAL_Z);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple LCG for deterministic pseudo-random numbers */
function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296 - 0.5; // [-0.5, +0.5]
  };
}

/** Deterministic random walk (I(1) process) */
function randomWalk(seed: number, start: number, n: number): number[] {
  const rng = makeLcg(seed);
  const out = [start];
  for (let i = 1; i < n; i++) out.push(out[i - 1] + rng());
  return out;
}

/** AR(1) stationary residual: alternating ±innovation with persistence phi */
function ar1Residuals(phi: number, innovation: number, n: number): number[] {
  const out: number[] = [innovation];
  for (let i = 1; i < n; i++) {
    out.push(phi * out[i - 1] + (i % 2 === 0 ? innovation : -innovation));
  }
  return out;
}

function makeContext(sym1: string, sym2: string, mid1: number, mid2: number): EvaluationContext {
  const symbolState = new SymbolStateManager();
  const isoTs = new Date(currentTs).toISOString();
  symbolState.onQuote({
    symbol: sym1, bidPrice: mid1 - 0.01, askPrice: mid1 + 0.01,
    bidSize: 100, askSize: 100, midPrice: mid1, spread: 0.02,
    microPrice: mid1, imbalance: 0, ts: currentTs, isoTs,
  });
  symbolState.onQuote({
    symbol: sym2, bidPrice: mid2 - 0.01, askPrice: mid2 + 0.01,
    bidSize: 100, askSize: 100, midPrice: mid2, spread: 0.02,
    microPrice: mid2, imbalance: 0, ts: currentTs, isoTs,
  });
  return {
    symbol: sym1,
    symbolState,
    portfolioState: new PortfolioStateManager(100_000),
    orderState: new OrderStateManager(),
  };
}

function getState(strategy: PairsStrategy): PairsInternalState {
  return (strategy as unknown as { state: PairsInternalState }).state;
}

function warmUp(strategy: PairsStrategy, bars = 5): void {
  mockZScore.mockReturnValue(NEUTRAL_Z);
  for (let i = 0; i < bars; i++) {
    currentTs += 1_000;
    mockNowMs.mockReturnValue(currentTs);
    strategy.evaluate(makeContext('A', 'B', 100, 100));
  }
}

// ---------------------------------------------------------------------------
// Engle-Granger indicator unit tests (real implementation, no mocks needed)
// ---------------------------------------------------------------------------
describe('computeEngleGranger indicator', () => {
  it('returns null for fewer than 5 observations', () => {
    expect(computeEngleGranger([1, 2, 3], [1, 2, 3])).toBeNull();
  });

  it('returns null when arrays have different lengths', () => {
    expect(computeEngleGranger([1, 2, 3, 4, 5], [1, 2, 3, 4])).toBeNull();
  });

  it('detects cointegration: leg1 = 2*leg2 + stationary AR(1) residual', () => {
    const n = 80;
    const leg2 = randomWalk(42, 100, n);
    const noise = ar1Residuals(0.4, 6, n); // fast-reverting, large innovation
    const leg1 = leg2.map((p, i) => 2 * p + noise[i]);

    const result = computeEngleGranger(leg1, leg2, 0.05);
    expect(result).not.toBeNull();
    expect(result!.isCointegrated).toBe(true);
    expect(result!.testStatistic).toBeLessThan(result!.criticalValue);
  });

  it('does not detect cointegration for two independent random walks', () => {
    const n = 80;
    const leg1 = randomWalk(1111, 100, n);
    const leg2 = randomWalk(9999, 100, n); // independent seed

    const result = computeEngleGranger(leg1, leg2, 0.05);
    expect(result).not.toBeNull();
    expect(result!.isCointegrated).toBe(false);
  });

  it('beta estimate approximates the true hedge ratio for a clean pair', () => {
    const n = 100;
    const leg2 = randomWalk(7, 100, n);
    const noise = ar1Residuals(0.3, 0.5, n);
    const leg1 = leg2.map((p, i) => 3 * p + noise[i]);

    const result = computeEngleGranger(leg1, leg2, 0.05);
    expect(result).not.toBeNull();
    expect(result!.beta).toBeCloseTo(3, 0);
  });
});

// ---------------------------------------------------------------------------
// Strategy cointegration gate — forced state + mocked z-score
// ---------------------------------------------------------------------------
describe('cointegration gate (rolling_ols mode)', () => {
  const cfg = createPairsConfig('A', 'B', {
    hedgeRatioMethod: 'rolling_ols',
    cointSignificanceLevel: 0.05,
    olsWindowMs: 999_999_999,
    olsRecalcIntervalBars: 999,
    minObservations: 5,
    entryZScore: 2,
    exitZScore: 0.5,
    stopLossZScore: 4,
    maxHoldingTimeMs: 86_400_000,
    cooldownMs: 0,
    rollingWindowMs: 999_999_999,
    tradeNotionalUsd: 5_000,
    fixedHedgeRatio: 1,
  });

  it('blocks entry when isCointegrated=false and lastCointStat is set', () => {
    const strategy = new PairsStrategy(cfg);
    strategy.start();
    warmUp(strategy);

    const s = getState(strategy);
    s.lastCointStat = -1.5;
    s.isCointegrated = false;

    mockZScore.mockReturnValueOnce(ENTRY_SHORT_Z); // z=2.5 would enter, but gate blocks
    currentTs += 1_000;
    mockNowMs.mockReturnValue(currentTs);
    const signal = strategy.evaluate(makeContext('A', 'B', 100, 100));
    expect(signal).toBeNull();
    expect(s.positionState).toBe('flat');
  });

  it('allows entry when isCointegrated=true', () => {
    const strategy = new PairsStrategy(cfg);
    strategy.start();
    warmUp(strategy);

    const s = getState(strategy);
    s.lastCointStat = -4.5;
    s.isCointegrated = true;

    mockZScore.mockReturnValueOnce(ENTRY_SHORT_Z); // z=2.5 — gate passes
    currentTs += 1_000;
    mockNowMs.mockReturnValue(currentTs);
    const signal = strategy.evaluate(makeContext('A', 'B', 100, 100));
    expect(signal).not.toBeNull();
    expect(signal!.direction).toBe('short');
    expect(s.positionState).toBe('short_spread');
  });

  it('no gate when lastCointStat is null (EG test not yet run)', () => {
    const strategy = new PairsStrategy(cfg);
    strategy.start();
    warmUp(strategy);

    // lastCointStat is null by default after init — gate does NOT block
    const s = getState(strategy);
    expect(s.lastCointStat).toBeNull();

    mockZScore.mockReturnValueOnce(ENTRY_SHORT_Z);
    currentTs += 1_000;
    mockNowMs.mockReturnValue(currentTs);
    const signal = strategy.evaluate(makeContext('A', 'B', 100, 100));
    expect(signal).not.toBeNull(); // entry fires because EG test hasn't run yet
  });

  it('does not gate fixed-hedge-ratio strategies', () => {
    const fixedCfg = createPairsConfig('A', 'B', {
      hedgeRatioMethod: 'fixed',
      fixedHedgeRatio: 1,
      minObservations: 5,
      entryZScore: 2,
      exitZScore: 0.5,
      stopLossZScore: 4,
      maxHoldingTimeMs: 86_400_000,
      cooldownMs: 0,
      rollingWindowMs: 999_999_999,
      tradeNotionalUsd: 5_000,
      olsWindowMs: 999_999_999,
      olsRecalcIntervalBars: 999,
    });
    const strategy = new PairsStrategy(fixedCfg);
    strategy.start();
    warmUp(strategy);

    const s = getState(strategy);
    s.lastCointStat = -1.0;
    s.isCointegrated = false; // would block in rolling_ols mode

    mockZScore.mockReturnValueOnce(ENTRY_SHORT_Z);
    currentTs += 1_000;
    mockNowMs.mockReturnValue(currentTs);
    const signal = strategy.evaluate(makeContext('A', 'B', 100, 100));
    expect(signal).not.toBeNull(); // fixed mode ignores gate
  });
});

// ---------------------------------------------------------------------------
// End-to-end: two independent random walks produce 0 entry signals
//
// This test does NOT mock computeZScore so real z-scores are computed.
// It exercises the full path: EG test runs → isCointegrated=false → gate blocks entries.
// ---------------------------------------------------------------------------
describe('unrelated stocks end-to-end (real EG test + real z-score)', () => {
  it('produces 0 entry signals for two independent random-walk price series', () => {
    // Use real computeZScore for this test (bypass the module-level mock)
    const realComputeZScore = jest.requireActual<typeof import('../../services/indicators/zscore')>(
      '../../services/indicators/zscore',
    ).computeZScore;
    mockZScore.mockImplementation(realComputeZScore);

    const cfg = createPairsConfig('X', 'Y', {
      hedgeRatioMethod: 'rolling_ols',
      cointSignificanceLevel: 0.05,
      olsWindowMs: 999_999_999,
      olsRecalcIntervalBars: 1,
      minObservations: 20,
      entryZScore: 1.5,
      exitZScore: 0.5,
      stopLossZScore: 4,
      maxHoldingTimeMs: 86_400_000,
      cooldownMs: 0,
      rollingWindowMs: 999_999_999,
      tradeNotionalUsd: 5_000,
      fixedHedgeRatio: 1,
    });
    const strategy = new PairsStrategy(cfg);
    strategy.start();

    const n = 100;
    const leg1 = randomWalk(1234, 100, n);
    const leg2 = randomWalk(5678, 100, n); // independent seed

    let entrySignalCount = 0;
    for (let i = 0; i < n; i++) {
      currentTs += 1_000;
      mockNowMs.mockReturnValue(currentTs);
      const signal = strategy.evaluate(makeContext('X', 'Y', leg1[i], leg2[i]));
      if (signal !== null && (signal.direction === 'long' || signal.direction === 'short')) {
        entrySignalCount++;
      }
    }

    expect(entrySignalCount).toBe(0);
  });
});
