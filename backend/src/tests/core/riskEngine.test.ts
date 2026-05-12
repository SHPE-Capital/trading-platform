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

jest.mock('../../utils/time');

import * as time from '../../utils/time';
import { RiskEngine } from '../../core/risk/riskEngine';
import type { OrderIntent } from '../../types/orders';
import type { PortfolioSnapshot, Position } from '../../types/portfolio';

const mockNowMs = time.nowMs as jest.Mock;

beforeEach(() => {
  mockNowMs.mockReturnValue(10_000);
  jest.clearAllMocks();
  mockNowMs.mockReturnValue(10_000);
});

function makeIntent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    id: 'intent-1',
    strategyId: 'strat-1',
    symbol: 'SPY',
    side: 'buy',
    qty: 10,
    orderType: 'market',
    timeInForce: 'day',
    ts: 10_000,
    ...overrides,
  };
}

function makePortfolio(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    id: 'snap-1',
    ts: 10_000,
    isoTs: new Date(10_000).toISOString(),
    cash: 100_000,
    positionsValue: 0,
    equity: 100_000,
    initialCapital: 100_000,
    totalUnrealizedPnl: 0,
    totalRealizedPnl: 0,
    totalPnl: 0,
    returnPct: 0,
    positions: [],
    positionCount: 0,
    ...overrides,
  };
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'pos-1',
    symbol: 'SPY',
    qty: 10,
    avgEntryPrice: 500,
    currentPrice: 500,
    marketValue: 5_000,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    realizedPnl: 0,
    costBasis: 5_000,
    openedAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------
describe('kill switch', () => {
  it('blocks all orders when kill switch is active', () => {
    const engine = new RiskEngine({ killSwitchActive: true });
    const result = engine.check(makeIntent(), makePortfolio());
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe('KILL_SWITCH');
  });

  it('passes when kill switch is inactive', () => {
    const engine = new RiskEngine({ killSwitchActive: false });
    expect(engine.check(makeIntent(), makePortfolio()).passed).toBe(true);
  });

  it('setKillSwitch(true) activates the kill switch', () => {
    const engine = new RiskEngine();
    engine.setKillSwitch(true);
    expect(engine.check(makeIntent(), makePortfolio()).passed).toBe(false);
  });

  it('setKillSwitch(false) deactivates the kill switch', () => {
    const engine = new RiskEngine({ killSwitchActive: true });
    engine.setKillSwitch(false);
    expect(engine.check(makeIntent(), makePortfolio()).passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Order cooldown
// ---------------------------------------------------------------------------
describe('order cooldown', () => {
  it('first order from a strategy always passes', () => {
    const engine = new RiskEngine({ orderCooldownMs: 5_000 });
    expect(engine.check(makeIntent(), makePortfolio()).passed).toBe(true);
  });

  it('second order within cooldown window is rejected', () => {
    const engine = new RiskEngine({ orderCooldownMs: 5_000 });
    mockNowMs.mockReturnValue(10_000);
    engine.check(makeIntent(), makePortfolio()); // first order records ts=10000

    mockNowMs.mockReturnValue(11_000); // only 1s later, cooldown is 5s
    const result = engine.check(makeIntent(), makePortfolio());
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe('ORDER_COOLDOWN');
  });

  it('order after cooldown expires passes', () => {
    const engine = new RiskEngine({ orderCooldownMs: 5_000 });
    mockNowMs.mockReturnValue(10_000);
    engine.check(makeIntent(), makePortfolio()); // records ts=10000

    mockNowMs.mockReturnValue(15_001); // 5001ms later > cooldown=5000
    expect(engine.check(makeIntent(), makePortfolio()).passed).toBe(true);
  });

  it('cooldown is per-strategy: different strategy IDs do not interfere', () => {
    const engine = new RiskEngine({ orderCooldownMs: 5_000 });
    mockNowMs.mockReturnValue(10_000);
    engine.check(makeIntent({ strategyId: 'strat-A' }), makePortfolio());

    mockNowMs.mockReturnValue(11_000);
    // Different strategy: no cooldown recorded
    const result = engine.check(makeIntent({ strategyId: 'strat-B' }), makePortfolio());
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Max position size
// ---------------------------------------------------------------------------
describe('max position size', () => {
  it('passes when no existing position and no limitPrice (cannot estimate)', () => {
    const engine = new RiskEngine({ maxPositionSizeUsd: 10_000 });
    // No limitPrice, no existing position → estimatedPrice=0 → check skipped
    expect(engine.check(makeIntent({ limitPrice: undefined }), makePortfolio()).passed).toBe(true);
  });

  it('rejects when new notional would exceed max position size', () => {
    const engine = new RiskEngine({ maxPositionSizeUsd: 10_000 });
    // Existing position: 10 shares * $500 = $5000
    const position = makePosition({ symbol: 'SPY', qty: 10, marketValue: 5_000, currentPrice: 500 });
    const portfolio = makePortfolio({ positions: [position] });
    // New order: 12 more at $500 = $6000, total would be $11000 > $10000
    const result = engine.check(makeIntent({ symbol: 'SPY', qty: 12 }), portfolio);
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe('MAX_POSITION_SIZE');
  });

  it('passes when combined notional is within limit', () => {
    const engine = new RiskEngine({ maxPositionSizeUsd: 10_000 });
    const position = makePosition({ symbol: 'SPY', qty: 5, marketValue: 2_500, currentPrice: 500 });
    const portfolio = makePortfolio({ positions: [position] });
    // New order: 5 more at $500 = $2500, total $5000 < $10000
    expect(engine.check(makeIntent({ symbol: 'SPY', qty: 5 }), portfolio).passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Max notional exposure
// ---------------------------------------------------------------------------
describe('max notional exposure', () => {
  it('skips check when no limitPrice is provided', () => {
    const engine = new RiskEngine({ maxNotionalExposureUsd: 50_000 });
    const portfolio = makePortfolio({ positionsValue: 49_000 });
    // No limitPrice → estimatedPrice=0 → check skipped
    expect(engine.check(makeIntent({ limitPrice: undefined }), portfolio).passed).toBe(true);
  });

  it('rejects when total exposure would exceed max notional', () => {
    const engine = new RiskEngine({ maxNotionalExposureUsd: 50_000 });
    // $48,000 of existing exposure in another symbol (the check recalculates from positions[])
    const existingPos = makePosition({ symbol: 'AAPL', qty: 96, currentPrice: 500, marketValue: 48_000 });
    const portfolio = makePortfolio({ positions: [existingPos] });
    // New SPY order: 10 shares at $500 = $5,000 → total $53,000 > $50,000
    const result = engine.check(makeIntent({ qty: 10, limitPrice: 500 }), portfolio);
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe('MAX_NOTIONAL_EXPOSURE');
  });

  it('passes when total exposure stays within limit', () => {
    const engine = new RiskEngine({ maxNotionalExposureUsd: 50_000 });
    // $40,000 of existing exposure in another symbol
    const existingPos = makePosition({ symbol: 'AAPL', qty: 80, currentPrice: 500, marketValue: 40_000 });
    const portfolio = makePortfolio({ positions: [existingPos] });
    // New SPY order: 10 shares at $500 = $5,000 → total $45,000 < $50,000
    expect(engine.check(makeIntent({ qty: 10, limitPrice: 500 }), portfolio).passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Short selling
// ---------------------------------------------------------------------------
describe('short selling', () => {
  it('rejects a sell order when short selling is disabled and no held position', () => {
    const engine = new RiskEngine({ allowShortSelling: false });
    const result = engine.check(makeIntent({ side: 'sell', qty: 10 }), makePortfolio());
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe('SHORT_SELLING_DISALLOWED');
  });

  it('rejects when sell qty exceeds held qty', () => {
    const engine = new RiskEngine({ allowShortSelling: false });
    const position = makePosition({ symbol: 'SPY', qty: 5 });
    const portfolio = makePortfolio({ positions: [position] });
    const result = engine.check(makeIntent({ side: 'sell', qty: 10 }), portfolio);
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe('SHORT_SELLING_DISALLOWED');
  });

  it('allows sell when held qty is sufficient', () => {
    const engine = new RiskEngine({ allowShortSelling: false });
    const position = makePosition({ symbol: 'SPY', qty: 10 });
    const portfolio = makePortfolio({ positions: [position] });
    expect(engine.check(makeIntent({ side: 'sell', qty: 10 }), portfolio).passed).toBe(true);
  });

  it('allows sell beyond held qty when allowShortSelling is true', () => {
    const engine = new RiskEngine({ allowShortSelling: true });
    expect(engine.check(makeIntent({ side: 'sell', qty: 100 }), makePortfolio()).passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Config management
// ---------------------------------------------------------------------------
describe('config management', () => {
  it('getConfig returns a copy of the current config', () => {
    const engine = new RiskEngine({ maxPositionSizeUsd: 9_999 });
    const cfg = engine.getConfig();
    expect(cfg.maxPositionSizeUsd).toBe(9_999);
    cfg.maxPositionSizeUsd = 0; // mutating the copy should not affect internal config
    expect(engine.getConfig().maxPositionSizeUsd).toBe(9_999);
  });

  it('updateConfig patches individual fields', () => {
    const engine = new RiskEngine();
    engine.updateConfig({ orderCooldownMs: 99_000 });
    expect(engine.getConfig().orderCooldownMs).toBe(99_000);
  });
});

// ---------------------------------------------------------------------------
// Check result shape
// ---------------------------------------------------------------------------
describe('check result shape', () => {
  it('passed result has no failedCheck or reason', () => {
    const engine = new RiskEngine();
    const result = engine.check(makeIntent(), makePortfolio());
    expect(result.passed).toBe(true);
    expect(result.failedCheck).toBeUndefined();
    expect(result.reason).toBeUndefined();
    expect(result.ts).toBeGreaterThan(0);
  });

  it('failed result includes failedCheck, reason, and ts', () => {
    const engine = new RiskEngine({ killSwitchActive: true });
    const result = engine.check(makeIntent(), makePortfolio());
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe('KILL_SWITCH');
    expect(result.reason).toBeDefined();
    expect(result.ts).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// estimateWorstCasePrice
// ---------------------------------------------------------------------------
describe('estimateWorstCasePrice', () => {
  it('limit order returns limitPrice regardless of mid or buffers', () => {
    const engine = new RiskEngine({ gapBufferBps: 200, spreadBufferBps: 100, slippageBps: 100 });
    expect(engine.estimateWorstCasePrice('buy', makeIntent({ limitPrice: 99 }), 500)).toBe(99);
  });

  it('limit order returns limitPrice even when mid is null', () => {
    const engine = new RiskEngine();
    expect(engine.estimateWorstCasePrice('buy', makeIntent({ limitPrice: 50 }), null)).toBe(50);
  });

  it('market buy applies composite buffer upward: mid * (1 + totalBps)', () => {
    // gapBufferBps=20, spreadBufferBps=5, slippageBps=5 → 30 bps = 0.003
    const engine = new RiskEngine({ gapBufferBps: 20, spreadBufferBps: 5, slippageBps: 5 });
    const price = engine.estimateWorstCasePrice('buy', makeIntent({ limitPrice: undefined }), 100);
    expect(price).toBeCloseTo(100.30, 4);
  });

  it('market sell applies composite buffer downward: mid * (1 − totalBps)', () => {
    const engine = new RiskEngine({ gapBufferBps: 20, spreadBufferBps: 5, slippageBps: 5 });
    const price = engine.estimateWorstCasePrice('sell', makeIntent({ limitPrice: undefined }), 100);
    expect(price).toBeCloseTo(99.70, 4);
  });

  it('returns null when mid is null', () => {
    const engine = new RiskEngine();
    expect(engine.estimateWorstCasePrice('buy', makeIntent({ limitPrice: undefined }), null)).toBeNull();
  });

  it('returns null when mid is zero', () => {
    const engine = new RiskEngine();
    expect(engine.estimateWorstCasePrice('buy', makeIntent({ limitPrice: undefined }), 0)).toBeNull();
  });

  it('returns null when mid is negative', () => {
    const engine = new RiskEngine();
    expect(engine.estimateWorstCasePrice('buy', makeIntent({ limitPrice: undefined }), -50)).toBeNull();
  });

  it('zero-buffer config returns mid unchanged for a market order', () => {
    const engine = new RiskEngine({ gapBufferBps: 0, spreadBufferBps: 0, slippageBps: 0 });
    expect(engine.estimateWorstCasePrice('buy', makeIntent({ limitPrice: undefined }), 200)).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// registerStrategyBudget + checkStrategyBudget
// ---------------------------------------------------------------------------
describe('checkStrategyBudget', () => {
  it('returns null when no budget is registered for the strategy', () => {
    const engine = new RiskEngine();
    expect(engine.checkStrategyBudget(makeIntent({ strategyId: 'x' }), 5_000, makePortfolio(), 0)).toBeNull();
  });

  it('returns null when projected usage is within budget', () => {
    const engine = new RiskEngine();
    // equity=100k, maxCapitalPct=0.20 → budget=$20k; already=5k, new=10k → 15k < 20k
    engine.registerStrategyBudget({ strategyId: 'strat-1', maxCapitalPct: 0.20 });
    const result = engine.checkStrategyBudget(
      makeIntent({ strategyId: 'strat-1' }), 10_000, makePortfolio({ equity: 100_000 }), 5_000,
    );
    expect(result).toBeNull();
  });

  it('returns null at the exact budget limit (boundary: projected == budget)', () => {
    const engine = new RiskEngine();
    // budget=10k, already=0, new=10k → projected=10k, not > 10k → passes
    engine.registerStrategyBudget({ strategyId: 'strat-1', maxCapitalPct: 0.10 });
    const result = engine.checkStrategyBudget(
      makeIntent({ strategyId: 'strat-1' }), 10_000, makePortfolio({ equity: 100_000 }), 0,
    );
    expect(result).toBeNull();
  });

  it('returns STRATEGY_BUDGET failure when projected usage exceeds budget', () => {
    const engine = new RiskEngine();
    // budget=10k, already=9k, new=2k → 11k > 10k → fails
    engine.registerStrategyBudget({ strategyId: 'strat-1', maxCapitalPct: 0.10 });
    const result = engine.checkStrategyBudget(
      makeIntent({ strategyId: 'strat-1' }), 2_000, makePortfolio({ equity: 100_000 }), 9_000,
    );
    expect(result).not.toBeNull();
    expect(result!.failedCheck).toBe('STRATEGY_BUDGET');
    expect(result!.reason).toMatch(/strat-1/);
  });

  it('returns STRATEGY_ORDER_NOTIONAL when per-order limit is exceeded', () => {
    const engine = new RiskEngine();
    // maxCapitalPct=50% (plenty), maxOrderNotionalPct=5% → $5k per order cap
    engine.registerStrategyBudget({ strategyId: 'strat-1', maxCapitalPct: 0.50, maxOrderNotionalPct: 0.05 });
    const result = engine.checkStrategyBudget(
      makeIntent({ strategyId: 'strat-1' }), 6_000, makePortfolio({ equity: 100_000 }), 0,
    );
    expect(result).not.toBeNull();
    expect(result!.failedCheck).toBe('STRATEGY_ORDER_NOTIONAL');
  });

  it('skips per-order check when maxOrderNotionalPct is not set', () => {
    const engine = new RiskEngine();
    engine.registerStrategyBudget({ strategyId: 'strat-1', maxCapitalPct: 0.50 });
    // large single order — no per-order limit configured
    const result = engine.checkStrategyBudget(
      makeIntent({ strategyId: 'strat-1' }), 40_000, makePortfolio({ equity: 100_000 }), 0,
    );
    expect(result).toBeNull();
  });

  it('budgets are isolated by strategyId', () => {
    const engine = new RiskEngine();
    // strat-A has a tiny budget; strat-B has none → strat-B check always passes
    engine.registerStrategyBudget({ strategyId: 'strat-A', maxCapitalPct: 0.01 });
    const result = engine.checkStrategyBudget(
      makeIntent({ strategyId: 'strat-B' }), 50_000, makePortfolio({ equity: 100_000 }), 0,
    );
    expect(result).toBeNull();
  });

  it('returns MAX_OPEN_ORDERS when strategy is at its open-order limit', () => {
    const engine = new RiskEngine();
    engine.registerStrategyBudget({ strategyId: 'strat-1', maxCapitalPct: 1.0, maxOpenOrders: 2 });
    // openOrderCount=2 equals the limit → blocked
    const result = engine.checkStrategyBudget(
      makeIntent({ strategyId: 'strat-1' }), 1_000, makePortfolio({ equity: 100_000 }), 0, 2,
    );
    expect(result).not.toBeNull();
    expect(result!.failedCheck).toBe('MAX_OPEN_ORDERS');
    expect(result!.reason).toMatch(/strat-1/);
  });

  it('allows an order when open-order count is below the limit', () => {
    const engine = new RiskEngine();
    engine.registerStrategyBudget({ strategyId: 'strat-1', maxCapitalPct: 1.0, maxOpenOrders: 3 });
    const result = engine.checkStrategyBudget(
      makeIntent({ strategyId: 'strat-1' }), 1_000, makePortfolio({ equity: 100_000 }), 0, 2,
    );
    expect(result).toBeNull();
  });

  it('skips the open-order check when maxOpenOrders is not set', () => {
    const engine = new RiskEngine();
    engine.registerStrategyBudget({ strategyId: 'strat-1', maxCapitalPct: 1.0 });
    // high count, but no limit configured → passes
    const result = engine.checkStrategyBudget(
      makeIntent({ strategyId: 'strat-1' }), 1_000, makePortfolio({ equity: 100_000 }), 0, 99,
    );
    expect(result).toBeNull();
  });

  it('MAX_OPEN_ORDERS is checked before capital budget', () => {
    const engine = new RiskEngine();
    // budget is tiny but open-order gate fires first
    engine.registerStrategyBudget({ strategyId: 'strat-1', maxCapitalPct: 0.01, maxOpenOrders: 1 });
    const result = engine.checkStrategyBudget(
      makeIntent({ strategyId: 'strat-1' }), 500, makePortfolio({ equity: 100_000 }), 0, 1,
    );
    expect(result!.failedCheck).toBe('MAX_OPEN_ORDERS');
  });
});

// ---------------------------------------------------------------------------
// checkPortfolio
// ---------------------------------------------------------------------------
describe('checkPortfolio', () => {
  it('returns null when equity is zero (guard against division by zero)', () => {
    const engine = new RiskEngine({ maxGrossExposurePct: 0.5 });
    expect(engine.checkPortfolio(makePortfolio({ equity: 0 }))).toBeNull();
  });

  it('returns null when no exposure or drawdown limits are configured', () => {
    const engine = new RiskEngine({
      maxGrossExposurePct: undefined, maxNetExposurePct: undefined, maxIntradayDrawdownPct: undefined,
    });
    const portfolio = makePortfolio({
      equity: 100_000,
      positions: [makePosition({ qty: 200, currentPrice: 500 })], // 100k gross
    });
    expect(engine.checkPortfolio(portfolio)).toBeNull();
  });

  it('returns null when gross exposure is within limit', () => {
    const engine = new RiskEngine({ maxGrossExposurePct: 1.0, maxIntradayDrawdownPct: undefined });
    const portfolio = makePortfolio({
      equity: 100_000,
      positions: [makePosition({ qty: 100, currentPrice: 500 })], // 50k = 50% < 100%
    });
    expect(engine.checkPortfolio(portfolio)).toBeNull();
  });

  it('returns MAX_GROSS_EXPOSURE when positions exceed limit', () => {
    const engine = new RiskEngine({ maxGrossExposurePct: 0.50, maxIntradayDrawdownPct: undefined });
    const portfolio = makePortfolio({
      equity: 100_000,
      positions: [makePosition({ qty: 200, currentPrice: 500 })], // 100k = 100% > 50%
    });
    const result = engine.checkPortfolio(portfolio);
    expect(result).not.toBeNull();
    expect(result!.check).toBe('MAX_GROSS_EXPOSURE');
    expect(result!.engageKillSwitch).toBe(false);
    expect(result!.grossExposurePct).toBeCloseTo(1.0, 5);
  });

  it('counts short positions (absolute value) in gross exposure', () => {
    // Short -100 shares @ $500 = $50k absolute, 50% of equity = exactly at limit → passes (strict >)
    const engine = new RiskEngine({ maxGrossExposurePct: 0.50, maxIntradayDrawdownPct: undefined });
    const portfolio = makePortfolio({
      equity: 100_000,
      positions: [makePosition({ qty: -100, currentPrice: 500 })],
    });
    expect(engine.checkPortfolio(portfolio)).toBeNull();
  });

  it('returns MAX_NET_EXPOSURE when directional imbalance exceeds limit', () => {
    const engine = new RiskEngine({
      maxNetExposurePct: 0.30, maxGrossExposurePct: undefined, maxIntradayDrawdownPct: undefined,
    });
    const portfolio = makePortfolio({
      equity: 100_000,
      positions: [makePosition({ qty: 100, currentPrice: 500 })], // $50k net = 50% > 30%
    });
    const result = engine.checkPortfolio(portfolio);
    expect(result).not.toBeNull();
    expect(result!.check).toBe('MAX_NET_EXPOSURE');
    expect(result!.engageKillSwitch).toBe(false);
  });

  it('net exposure cancels for a balanced long/short book', () => {
    const engine = new RiskEngine({
      maxNetExposurePct: 0.05, maxGrossExposurePct: undefined, maxIntradayDrawdownPct: undefined,
    });
    // Long $50k SPY + Short -$50k QQQ → net = 0 < 5%
    const longPos  = makePosition({ symbol: 'SPY', qty: 100,  currentPrice: 500 });
    const shortPos = makePosition({ symbol: 'QQQ', qty: -125, currentPrice: 400 });
    const portfolio = makePortfolio({ equity: 100_000, positions: [longPos, shortPos] });
    expect(engine.checkPortfolio(portfolio)).toBeNull();
  });

  it('returns INTRADAY_DRAWDOWN and engages kill switch when drawdown breaches limit', () => {
    const engine = new RiskEngine({
      maxIntradayDrawdownPct: 0.05, maxGrossExposurePct: undefined, maxNetExposurePct: undefined,
    });
    engine.check(makeIntent({ id: 'seed' }), makePortfolio({ equity: 100_000 }));
    const portfolio = makePortfolio({ equity: 94_000 }); // 6% drawdown > 5%
    const result = engine.checkPortfolio(portfolio);
    expect(result).not.toBeNull();
    expect(result!.check).toBe('INTRADAY_DRAWDOWN');
    expect(result!.engageKillSwitch).toBe(true);
    expect(engine.getConfig().killSwitchActive).toBe(true);
  });

  it('does not trigger drawdown when sessionStartEquity is null', () => {
    const engine = new RiskEngine({
      maxIntradayDrawdownPct: 0.05, maxGrossExposurePct: undefined, maxNetExposurePct: undefined,
    });
    // sessionStartEquity remains null — drawdown check skipped
    expect(engine.checkPortfolio(makePortfolio({ equity: 50_000 }))).toBeNull();
  });

  it('does not trigger drawdown when below threshold (dd < limit)', () => {
    const engine = new RiskEngine({
      maxIntradayDrawdownPct: 0.05, maxGrossExposurePct: undefined, maxNetExposurePct: undefined,
    });
    engine.check(makeIntent({ id: 'seed' }), makePortfolio({ equity: 100_000 }));
    // 4.999% drawdown is below 5% limit
    expect(engine.checkPortfolio(makePortfolio({ equity: 95_001 }))).toBeNull();
  });

  it('triggers drawdown at exactly the limit (dd >= limit is inclusive)', () => {
    const engine = new RiskEngine({
      maxIntradayDrawdownPct: 0.05, maxGrossExposurePct: undefined, maxNetExposurePct: undefined,
    });
    // Seed sessionStartEquity via check() — the canonical initialization path
    engine.check(makeIntent({ id: 'seed' }), makePortfolio({ equity: 100_000 }));
    // Exactly 5% drawdown → 0.05 >= 0.05 is true → triggers
    const result = engine.checkPortfolio(makePortfolio({ equity: 95_000 }));
    expect(result).not.toBeNull();
    expect(result!.check).toBe('INTRADAY_DRAWDOWN');
  });
});
