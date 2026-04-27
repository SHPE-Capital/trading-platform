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
    const portfolio = makePortfolio({ positionsValue: 48_000 });
    // New order: 10 shares at $500 limit = $5000, total $53000 > $50000
    const result = engine.check(makeIntent({ qty: 10, limitPrice: 500 }), portfolio);
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe('MAX_NOTIONAL_EXPOSURE');
  });

  it('passes when total exposure stays within limit', () => {
    const engine = new RiskEngine({ maxNotionalExposureUsd: 50_000 });
    const portfolio = makePortfolio({ positionsValue: 40_000 });
    // New order: 10 shares at $500 = $5000, total $45000 < $50000
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
