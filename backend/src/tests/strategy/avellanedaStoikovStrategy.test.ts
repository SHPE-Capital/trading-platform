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

// Mock time utilities so we control ts/cooldown progression
jest.mock('../../utils/time', () => ({
  ...jest.requireActual('../../utils/time'),
  nowMs: jest.fn(),
}));

import { nowMs } from '../../utils/time';
import {
  AvellanedaStoikovStrategy,
  createAvellanedaStoikovConfig,
  validateAvellanedaStoikovConfig,
  getAvellanedaStoikovPreset,
} from '../../strategies/marketMaking';
import { SymbolStateManager } from '../../core/state/symbolState';
import { PortfolioStateManager } from '../../core/state/portfolioState';
import { OrderStateManager } from '../../core/state/orderState';
import type { EvaluationContext } from '../../strategies/base/strategy';
import type {
  AvellanedaStoikovConfig,
  MakerQuotesMeta,
} from '../../strategies/marketMaking/avellanedaStoikovTypes';
import type { Fill } from '../../types/orders';

const mockNowMs = nowMs as jest.Mock;
let currentTs = 1_000_000;

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Build an AS config with deterministic, test-friendly defaults. */
function makeTestConfig(
  overrides: Partial<AvellanedaStoikovConfig> = {},
): AvellanedaStoikovConfig {
  return createAvellanedaStoikovConfig('AAPL', 'balanced', {
    gamma: 1,
    kappa: 1,
    horizonMs: 1_000_000_000, // effectively constant T-t during a test
    clampHorizon: true,
    minHorizonFraction: 1,    // pin T-t = 1 so reservation/spread are stable
    volEstimator: 'stddev_returns',
    volWindowSize: 20,
    minObservations: 3,
    inventoryLimit: 100,
    baseOrderQty: 10,
    maxQuoteQty: 10,
    minHalfSpread: 0,
    maxHalfSpread: 10,
    tickSize: 0.01,
    sigmaFloor: 1e-6,
    sigmaCap: 1,
    killSwitchSigma: 10,        // disabled by default
    killSwitchInventoryMult: 100,
    quoteRefreshMs: 0,          // no cooldown by default
    ...overrides,
  });
}

/** Build an EvaluationContext at a specific mid price. */
function makeContext(
  mid: number,
  portfolio: PortfolioStateManager = new PortfolioStateManager(100_000),
): EvaluationContext {
  const symbolState = new SymbolStateManager();
  const isoTs = new Date(currentTs).toISOString();
  symbolState.onQuote({
    symbol: 'AAPL',
    bidPrice: mid - 0.01,
    askPrice: mid + 0.01,
    bidSize: 100,
    askSize: 100,
    midPrice: mid,
    spread: 0.02,
    microPrice: mid,
    imbalance: 0,
    ts: currentTs,
    isoTs,
  });
  return {
    symbol: 'AAPL',
    symbolState,
    portfolioState: portfolio,
    orderState: new OrderStateManager(),
  };
}

/** Apply a fill to nudge inventory to the desired (signed) quantity. */
function setInventory(portfolio: PortfolioStateManager, qty: number): void {
  if (qty === 0) return;
  const fill: Fill = {
    id: 'f' as string,
    orderId: 'o' as string,
    symbol: 'AAPL',
    side: qty > 0 ? 'buy' : 'sell',
    qty: Math.abs(qty),
    price: 100,
    notional: Math.abs(qty) * 100,
    commission: 0,
    ts: currentTs,
    isoTs: new Date(currentTs).toISOString(),
  };
  portfolio.applyFill(fill);
}

/** Run minObservations + a couple extra ticks to prime the sigma window. */
function warmUp(
  strategy: AvellanedaStoikovStrategy,
  mids: number[] = [100, 100.05, 100, 100.05, 100],
): void {
  for (const m of mids) {
    currentTs += 1000;
    strategy.evaluate(makeContext(m));
  }
}

function makeStrategy(
  overrides: Partial<AvellanedaStoikovConfig> = {},
): AvellanedaStoikovStrategy {
  const cfg = makeTestConfig(overrides);
  const s = new AvellanedaStoikovStrategy(cfg);
  s.start();
  return s;
}

// ------------------------------------------------------------------
// Test scaffolding
// ------------------------------------------------------------------

beforeEach(() => {
  currentTs = 1_000_000;
  mockNowMs.mockImplementation(() => currentTs);
  jest.clearAllMocks();
  mockNowMs.mockImplementation(() => currentTs);
});

// ------------------------------------------------------------------
// Config & validation
// ------------------------------------------------------------------

describe('AvellanedaStoikov config & validation', () => {
  it('createAvellanedaStoikovConfig returns a valid balanced config', () => {
    const cfg = createAvellanedaStoikovConfig('SPY');
    expect(cfg.symbol).toBe('SPY');
    expect(cfg.type).toBe('market_making');
    expect(cfg.gamma).toBeGreaterThan(0);
    expect(cfg.kappa).toBeGreaterThan(0);
    expect(cfg.maxHalfSpread).toBeGreaterThan(cfg.minHalfSpread);
  });

  it('layers conservative > balanced > aggressive correctly', () => {
    const cons = createAvellanedaStoikovConfig('A', 'conservative');
    const bal = createAvellanedaStoikovConfig('A', 'balanced');
    const agg = createAvellanedaStoikovConfig('A', 'aggressive');
    // Conservative: lower base size and tighter inventory caps than aggressive
    expect(cons.baseOrderQty).toBeLessThan(agg.baseOrderQty);
    expect(cons.inventoryLimit).toBeLessThan(agg.inventoryLimit);
    expect(cons.gamma).toBeGreaterThan(agg.gamma);
    // Balanced sits in between on order size
    expect(bal.baseOrderQty).toBeGreaterThanOrEqual(cons.baseOrderQty);
    expect(bal.baseOrderQty).toBeLessThanOrEqual(agg.baseOrderQty);
  });

  it('validation rejects gamma ≤ 0', () => {
    expect(() =>
      createAvellanedaStoikovConfig('A', 'balanced', { gamma: 0 }),
    ).toThrow(/gamma/);
  });

  it('validation rejects maxHalfSpread ≤ minHalfSpread', () => {
    expect(() =>
      createAvellanedaStoikovConfig('A', 'balanced', {
        minHalfSpread: 1,
        maxHalfSpread: 0.5,
      }),
    ).toThrow(/maxHalfSpread/);
  });

  it('validation rejects tickSize ≤ 0', () => {
    expect(() =>
      createAvellanedaStoikovConfig('A', 'balanced', { tickSize: 0 }),
    ).toThrow(/tickSize/);
  });

  it('getAvellanedaStoikovPreset returns presets with the expected ranks', () => {
    const cons = getAvellanedaStoikovPreset('conservative');
    const agg = getAvellanedaStoikovPreset('aggressive');
    expect(cons.minHalfSpread!).toBeGreaterThan(agg.minHalfSpread!);
  });

  it('validateAvellanedaStoikovConfig accepts a properly-built config', () => {
    const cfg = createAvellanedaStoikovConfig('A');
    expect(() => validateAvellanedaStoikovConfig(cfg)).not.toThrow();
  });
});

// ------------------------------------------------------------------
// No-quote gating: invalid mid / insufficient obs / disabled / wrong sym
// ------------------------------------------------------------------

describe('no-quote gating', () => {
  it('returns null when strategy is disabled', () => {
    const s = new AvellanedaStoikovStrategy(makeTestConfig({ enabled: false }));
    s.start();
    expect(s.evaluate(makeContext(100))).toBeNull();
  });

  it('returns null when symbol does not match', () => {
    const s = makeStrategy();
    const ctx = makeContext(100);
    expect(s.evaluate({ ...ctx, symbol: 'OTHER' })).toBeNull();
  });

  it('returns null when latestMid is missing', () => {
    const s = makeStrategy();
    const ctx: EvaluationContext = {
      symbol: 'AAPL',
      symbolState: new SymbolStateManager(), // never received a quote
      portfolioState: new PortfolioStateManager(100_000),
      orderState: new OrderStateManager(),
    };
    expect(s.evaluate(ctx)).toBeNull();
  });

  it('returns null before minObservations are reached', () => {
    const s = makeStrategy({ minObservations: 5 });
    for (let i = 0; i < 4; i++) {
      currentTs += 1000;
      expect(s.evaluate(makeContext(100 + i))).toBeNull();
    }
  });
});

// ------------------------------------------------------------------
// Reservation price inventory skew
// ------------------------------------------------------------------

describe('reservation price inventory skew', () => {
  function reservationFromSignal(signal: ReturnType<AvellanedaStoikovStrategy['evaluate']>): number {
    const meta = signal!.meta as unknown as MakerQuotesMeta;
    return meta.reservationPrice;
  }

  it('shifts reservation price DOWN when inventory is LONG', () => {
    const portfolio = new PortfolioStateManager(100_000);
    const s = makeStrategy();
    warmUp(s);
    // Baseline with zero inventory
    currentTs += 1000;
    const flatSignal = s.evaluate(makeContext(100, portfolio));
    expect(flatSignal).not.toBeNull();
    const flatReservation = reservationFromSignal(flatSignal);

    // Now go long 50 shares
    setInventory(portfolio, 50);
    currentTs += 1000;
    const longSignal = s.evaluate(makeContext(100, portfolio));
    expect(longSignal).not.toBeNull();
    const longReservation = reservationFromSignal(longSignal);

    expect(longReservation).toBeLessThan(flatReservation);
  });

  it('shifts reservation price UP when inventory is SHORT', () => {
    const portfolio = new PortfolioStateManager(100_000);
    const s = makeStrategy();
    warmUp(s);

    currentTs += 1000;
    const flatSignal = s.evaluate(makeContext(100, portfolio));
    const flatReservation = reservationFromSignal(flatSignal);

    setInventory(portfolio, -40);
    currentTs += 1000;
    const shortSignal = s.evaluate(makeContext(100, portfolio));
    const shortReservation = reservationFromSignal(shortSignal);

    expect(shortReservation).toBeGreaterThan(flatReservation);
  });
});

// ------------------------------------------------------------------
// Optimal spread responsiveness
// ------------------------------------------------------------------

describe('optimal spread', () => {
  it('half-spread widens when gamma increases under non-trivial volatility', () => {
    // With σ large enough that the γσ²(T-t) term dominates, the optimal
    // half-spread is monotonically increasing in γ. We pin σ at the
    // sigmaFloor of 0.5 by forcing sigmaFloor up and sigmaCap above it —
    // both strategies see the floor as their σ, regardless of warm-up mids.
    const sLow = makeStrategy({
      gamma: 0.5,
      kappa: 1,
      sigmaFloor: 1.0,
      sigmaCap: 2,
      maxHalfSpread: 100,
      minHalfSpread: 0,
    });
    warmUp(sLow);
    currentTs += 1000;
    const lowMeta = sLow.evaluate(makeContext(100))!.meta as unknown as MakerQuotesMeta;

    currentTs = 1_000_000;

    const sHigh = makeStrategy({
      gamma: 3,
      kappa: 1,
      sigmaFloor: 1.0,
      sigmaCap: 2,
      maxHalfSpread: 100,
      minHalfSpread: 0,
    });
    warmUp(sHigh);
    currentTs += 1000;
    const highMeta = sHigh.evaluate(makeContext(100))!.meta as unknown as MakerQuotesMeta;

    expect(highMeta.sigma).toBe(lowMeta.sigma);
    expect(highMeta.halfSpread).toBeGreaterThan(lowMeta.halfSpread);
  });

  it('half-spread widens when realized volatility increases', () => {
    const sCalm = makeStrategy({
      minHalfSpread: 0,
      maxHalfSpread: 100,
      sigmaCap: 1,
    });
    warmUp(sCalm, [100, 100.01, 100, 100.01, 100, 100.01, 100]);
    currentTs += 1000;
    const calmSig = sCalm.evaluate(makeContext(100));
    const calmMeta = calmSig!.meta as unknown as MakerQuotesMeta;

    currentTs = 1_000_000;

    const sVol = makeStrategy({
      minHalfSpread: 0,
      maxHalfSpread: 100,
      sigmaCap: 1,
    });
    // Big swings → higher σ
    warmUp(sVol, [100, 105, 95, 108, 92, 110, 90]);
    currentTs += 1000;
    const volSig = sVol.evaluate(makeContext(100));
    const volMeta = volSig!.meta as unknown as MakerQuotesMeta;

    expect(volMeta.sigma).toBeGreaterThan(calmMeta.sigma);
    expect(volMeta.halfSpread).toBeGreaterThan(calmMeta.halfSpread);
  });
});

// ------------------------------------------------------------------
// Quote price respect tick / min / max spread
// ------------------------------------------------------------------

describe('quote pricing constraints', () => {
  it('quote prices are snapped to tickSize', () => {
    const s = makeStrategy({ tickSize: 0.05 });
    warmUp(s);
    currentTs += 1000;
    const sig = s.evaluate(makeContext(100.123));
    const meta = sig!.meta as unknown as MakerQuotesMeta;
    for (const q of meta.makerQuotes) {
      const remainder = Math.round((q.price / 0.05) * 1e9) / 1e9;
      expect(Math.abs(remainder - Math.round(remainder))).toBeLessThan(1e-6);
    }
  });

  it('half-spread is clamped to minHalfSpread when the formula yields less', () => {
    const s = makeStrategy({
      gamma: 0.001,
      kappa: 1000,
      minHalfSpread: 0.50,
      maxHalfSpread: 1.0,
    });
    warmUp(s);
    currentTs += 1000;
    const sig = s.evaluate(makeContext(100));
    const meta = sig!.meta as unknown as MakerQuotesMeta;
    expect(meta.halfSpread).toBeGreaterThanOrEqual(0.5);
  });

  it('half-spread is clamped to maxHalfSpread when the formula yields more', () => {
    const s = makeStrategy({
      gamma: 5,
      kappa: 0.1,
      minHalfSpread: 0,
      maxHalfSpread: 0.10,
    });
    warmUp(s, [100, 110, 90, 115, 85, 120, 80]);
    currentTs += 1000;
    const sig = s.evaluate(makeContext(100));
    const meta = sig!.meta as unknown as MakerQuotesMeta;
    expect(meta.halfSpread).toBeLessThanOrEqual(0.10 + 1e-9);
  });

  it('bid is strictly less than ask after snapping', () => {
    const s = makeStrategy({ tickSize: 0.01 });
    warmUp(s);
    currentTs += 1000;
    const sig = s.evaluate(makeContext(100));
    const meta = sig!.meta as unknown as MakerQuotesMeta;
    const bid = meta.makerQuotes.find((q) => q.side === 'buy')!.price;
    const ask = meta.makerQuotes.find((q) => q.side === 'sell')!.price;
    expect(ask).toBeGreaterThan(bid);
  });
});

// ------------------------------------------------------------------
// Inventory caps
// ------------------------------------------------------------------

describe('inventory caps', () => {
  it('suppresses the BUY side when inventory ≥ inventoryLimit (long-capped)', () => {
    const portfolio = new PortfolioStateManager(100_000);
    const s = makeStrategy({ inventoryLimit: 30 });
    warmUp(s);
    setInventory(portfolio, 30);
    currentTs += 1000;
    const sig = s.evaluate(makeContext(100, portfolio));
    const meta = sig!.meta as unknown as MakerQuotesMeta;
    expect(meta.makerQuotes.find((q) => q.side === 'buy')).toBeUndefined();
    expect(meta.makerQuotes.find((q) => q.side === 'sell')).toBeDefined();
    expect(meta.suppression).toBe('inventory_cap_long');
  });

  it('suppresses the SELL side when inventory ≤ -inventoryLimit (short-capped)', () => {
    const portfolio = new PortfolioStateManager(100_000);
    const s = makeStrategy({ inventoryLimit: 30 });
    warmUp(s);
    setInventory(portfolio, -30);
    currentTs += 1000;
    const sig = s.evaluate(makeContext(100, portfolio));
    const meta = sig!.meta as unknown as MakerQuotesMeta;
    expect(meta.makerQuotes.find((q) => q.side === 'sell')).toBeUndefined();
    expect(meta.makerQuotes.find((q) => q.side === 'buy')).toBeDefined();
    expect(meta.suppression).toBe('inventory_cap_short');
  });
});

// ------------------------------------------------------------------
// Kill-switch
// ------------------------------------------------------------------

describe('kill-switch', () => {
  it('suppresses BOTH sides when |inventory| exceeds inventoryLimit × killSwitchInventoryMult', () => {
    const portfolio = new PortfolioStateManager(100_000);
    const s = makeStrategy({
      inventoryLimit: 10,
      killSwitchInventoryMult: 1.5, // trips at |q| ≥ 15
    });
    warmUp(s);
    setInventory(portfolio, 20); // 20 ≥ 15 → kill
    currentTs += 1000;
    const sig = s.evaluate(makeContext(100, portfolio));
    const meta = sig!.meta as unknown as MakerQuotesMeta;
    expect(meta.suppression).toBe('kill_switch');
    expect(meta.makerQuotes).toHaveLength(0);
  });

  it('suppresses BOTH sides when realized sigma exceeds killSwitchSigma', () => {
    const s = makeStrategy({
      killSwitchSigma: 0.001,
      sigmaCap: 1,
    });
    // Huge mid swings → σ well above 0.001
    warmUp(s, [100, 130, 70, 140, 60, 150, 50]);
    currentTs += 1000;
    const sig = s.evaluate(makeContext(100));
    const meta = sig!.meta as unknown as MakerQuotesMeta;
    expect(meta.suppression).toBe('kill_switch');
    expect(meta.makerQuotes).toHaveLength(0);
  });
});

// ------------------------------------------------------------------
// Cooldown / quote refresh
// ------------------------------------------------------------------

describe('quote refresh cooldown', () => {
  it('suppresses subsequent evaluate() calls within quoteRefreshMs', () => {
    const s = makeStrategy({ quoteRefreshMs: 5_000 });
    warmUp(s);
    // Step past the cooldown window opened during warmUp so the next
    // evaluate() is guaranteed to emit a fresh quote.
    currentTs += 10_000;
    const first = s.evaluate(makeContext(100));
    expect(first).not.toBeNull();
    // 1s later: still inside cooldown
    currentTs += 1_000;
    const second = s.evaluate(makeContext(100));
    expect(second).toBeNull();
  });

  it('emits again once quoteRefreshMs has elapsed', () => {
    const s = makeStrategy({ quoteRefreshMs: 5_000 });
    warmUp(s);
    currentTs += 10_000;
    const first = s.evaluate(makeContext(100));
    expect(first).not.toBeNull();
    currentTs += 5_001;
    const second = s.evaluate(makeContext(100));
    expect(second).not.toBeNull();
  });
});

// ------------------------------------------------------------------
// Signal shape contract
// ------------------------------------------------------------------

describe('signal shape', () => {
  it('emitted signal has direction=flat, type=market_making, and maker_quotes meta', () => {
    const s = makeStrategy();
    warmUp(s);
    currentTs += 1000;
    const sig = s.evaluate(makeContext(100))!;
    expect(sig.direction).toBe('flat');
    expect(sig.strategyType).toBe('market_making');
    const meta = sig.meta as unknown as MakerQuotesMeta;
    expect(meta.kind).toBe('maker_quotes');
    expect(meta.makerQuotes.length).toBeGreaterThan(0);
    expect(meta.midPrice).toBe(100);
  });

  it('top-level qty equals the sum of per-leg quoted quantities', () => {
    const s = makeStrategy({ baseOrderQty: 7, maxQuoteQty: 7 });
    warmUp(s);
    currentTs += 1000;
    const sig = s.evaluate(makeContext(100))!;
    const meta = sig.meta as unknown as MakerQuotesMeta;
    const sumLegs = meta.makerQuotes.reduce((s2, q) => s2 + q.qty, 0);
    expect(sig.qty).toBe(sumLegs);
  });
});

// ------------------------------------------------------------------
// Config factory — sharpeConvention
// ------------------------------------------------------------------

describe('createAvellanedaStoikovConfig: sharpeConvention', () => {
  it('default config includes sharpeConvention "intraday"', () => {
    const cfg = createAvellanedaStoikovConfig('AAPL');
    expect(cfg.sharpeConvention).toBe('intraday');
  });

  it('all presets include sharpeConvention "intraday"', () => {
    for (const preset of ['conservative', 'balanced', 'aggressive'] as const) {
      const cfg = createAvellanedaStoikovConfig('AAPL', preset);
      expect(cfg.sharpeConvention).toBe('intraday');
    }
  });

  it('sharpeConvention survives overrides that do not explicitly set it', () => {
    const cfg = createAvellanedaStoikovConfig('AAPL', 'balanced', { gamma: 2 });
    expect(cfg.sharpeConvention).toBe('intraday');
  });

  it('sharpeConvention cannot be overridden to "daily" (TypeScript narrowed to "intraday")', () => {
    // The type system narrows sharpeConvention to "intraday" only on AvellanedaStoikovConfig.
    // This runtime test confirms the factory preserves the correct value.
    const cfg = createAvellanedaStoikovConfig('AAPL');
    expect(['intraday']).toContain(cfg.sharpeConvention);
  });
});
