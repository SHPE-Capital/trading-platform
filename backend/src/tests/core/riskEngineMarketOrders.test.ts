jest.mock('../../config/env', () => ({
  env: {
    alpacaApiKey: 'k', alpacaApiSecret: 's', alpacaTradingMode: 'paper',
    alpacaPaperBaseUrl: '', alpacaLiveBaseUrl: '',
    alpacaDataStreamUrl: '', alpacaPaperStreamUrl: '', alpacaLiveStreamUrl: '',
    supabaseUrl: '', supabaseAnonKey: '', supabaseServiceRoleKey: '',
    port: 8080, nodeEnv: 'test', corsOrigin: '', logLevel: 'error',
    defaultRollingWindowMs: 60_000, maxPositionSizeUsd: 10_000,
    maxNotionalExposureUsd: 50_000, orderCooldownMs: 5_000,
    enableLiveTrading: false, enableWebSocketPush: false, databaseUrl: '',
  },
}));

jest.mock('../../utils/time');

import * as time from '../../utils/time';
import { RiskEngine } from '../../core/risk/riskEngine';
import { CapitalReservationManager } from '../../core/oms/capitalReservation';
import type { OrderIntent } from '../../types/orders';
import type { PortfolioSnapshot, Position } from '../../types/portfolio';

const mockNowMs = time.nowMs as jest.Mock;
beforeEach(() => mockNowMs.mockReturnValue(10_000));

function makeIntent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    id: 'i', strategyId: 's', symbol: 'SPY', side: 'buy', qty: 10,
    orderType: 'market', timeInForce: 'ioc', ts: 10_000, ...overrides,
  };
}

function makePortfolio(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    id: 'snap', ts: 10_000, isoTs: '', cash: 100_000, positionsValue: 0,
    equity: 100_000, initialCapital: 100_000, totalUnrealizedPnl: 0,
    totalRealizedPnl: 0, totalPnl: 0, returnPct: 0,
    positions: [], positionCount: 0, ...overrides,
  };
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'p', symbol: 'SPY', qty: 10, avgEntryPrice: 100, currentPrice: 100,
    marketValue: 1_000, unrealizedPnl: 0, unrealizedPnlPct: 0,
    realizedPnl: 0, costBasis: 1_000, openedAt: 0, updatedAt: 0, ...overrides,
  };
}

describe('RiskEngine: market order checks with reference price (fix #4)', () => {
  describe('max notional exposure uses reference price for market orders', () => {
    it('rejects a market BUY that would exceed exposure limit using referencePrice', () => {
      const engine = new RiskEngine({ maxNotionalExposureUsd: 5_000, maxPositionSizeUsd: 1e12 });
      // No existing positions, but a market order at $500 * 100 shares = $50,000
      // would exceed the $5,000 cap. Previously: limitPrice=undefined → check
      // short-circuited and let this through. Now: referencePrice fills the gap.
      const result = engine.check(
        makeIntent({ qty: 100, orderType: 'market', limitPrice: undefined }),
        makePortfolio(),
        500, // current market price
      );
      expect(result.passed).toBe(false);
      expect(result.failedCheck).toBe('MAX_NOTIONAL_EXPOSURE');
    });

    it('passes when no referencePrice and no other source — still does not pretend price=0', () => {
      const engine = new RiskEngine({ maxNotionalExposureUsd: 5_000 });
      // No reference price → check skipped; never treats undefined as 0.
      const result = engine.check(
        makeIntent({ qty: 100, limitPrice: undefined }),
        makePortfolio(),
      );
      expect(result.passed).toBe(true);
    });
  });

  describe('cash reserve check for market BUY orders', () => {
    it('rejects a market BUY whose cost exceeds available cash after reserve', () => {
      const engine = new RiskEngine({
        maxNotionalExposureUsd: 1e12, maxPositionSizeUsd: 1e12,
        cashReservePct: 0.10, // 10% reserve of equity
      });
      // Cash=10,000, equity=10,000 → reserve floor=1,000 → available=9,000.
      // Order: 200 * $50 = $10,000 > available $9,000.
      const result = engine.check(
        makeIntent({ qty: 200 }),
        makePortfolio({ cash: 10_000, equity: 10_000 }),
        50,
      );
      expect(result.passed).toBe(false);
      expect(result.failedCheck).toBe('CASH_RESERVE');
    });

    it('passes a BUY that fits within the available cash budget', () => {
      const engine = new RiskEngine({
        maxNotionalExposureUsd: 1e12, maxPositionSizeUsd: 1e12,
        cashReservePct: 0.10,
        maxConcentrationPct: 1.0, // disable concentration gate for this case
        maxIntradayDrawdownPct: undefined,
      });
      // Available cash = 10,000 - 1,000 reserve = 9,000. Order 100*$50 = $5,000.
      const result = engine.check(
        makeIntent({ qty: 100 }),
        makePortfolio({ cash: 10_000, equity: 10_000 }),
        50,
      );
      expect(result.passed).toBe(true);
    });

    it('SELL orders are not blocked by cash reserve (they generate cash)', () => {
      const engine = new RiskEngine({
        maxNotionalExposureUsd: 1e12, maxPositionSizeUsd: 1e12,
        cashReservePct: 0.10, allowShortSelling: true,
      });
      const result = engine.check(
        makeIntent({ side: 'sell', qty: 200 }),
        makePortfolio({ cash: 10_000, equity: 10_000 }),
        50,
      );
      // SELL is not gated by cash reserve.
      expect(result.failedCheck).not.toBe('CASH_RESERVE');
    });

    it('prevents arbitrarily negative cash: rejects when cost > cash even with zero reserve', () => {
      const engine = new RiskEngine({
        maxNotionalExposureUsd: 1e12, maxPositionSizeUsd: 1e12,
        cashReservePct: 0,
      });
      // Cash=1,000, order=100*$50=$5,000.
      const result = engine.check(
        makeIntent({ qty: 100 }),
        makePortfolio({ cash: 1_000, equity: 1_000 }),
        50,
      );
      expect(result.passed).toBe(false);
      expect(result.failedCheck).toBe('CASH_RESERVE');
    });
  });

  describe('capital reservation for sell orders', () => {
    it('does not consume cash for sell intents', () => {
      const manager = new CapitalReservationManager();
      const intent = makeIntent({ side: 'sell', qty: 100 });
      const receipt = manager.reserve(intent, 5_000, 10_000);

      expect(receipt).not.toBeNull();
      expect(receipt?.amount).toBe(0);
      expect(manager.getAvailableCash(10_000)).toBe(10_000);
    });
  });

  describe('cash reserve gate for SELL orders (Copilot fix)', () => {
    it('allows a sell that covers an existing long even when cash is at the reserve floor', () => {
      // 100% reserve floor = $1,000; cash = $1,000 → at floor.
      // But selling 10 shares to close an existing 10-share long is always allowed.
      const engine = new RiskEngine({
        cashReservePct: 1.0,
        maxNotionalExposureUsd: 1e12, maxPositionSizeUsd: 1e12, allowShortSelling: true,
      });
      const position = makePosition({ symbol: 'SPY', qty: 10, currentPrice: 100 });
      const result = engine.check(
        makeIntent({ side: 'sell', qty: 10 }),
        makePortfolio({ cash: 1_000, equity: 1_000, positions: [position] }),
        100,
      );
      expect(result.failedCheck).not.toBe('CASH_RESERVE');
    });

    it('rejects a sell that would open a new short when cash is at or below the reserve floor', () => {
      // No existing position → selling 10 shares opens a short.
      // cash = reserveFloor → blocked.
      const engine = new RiskEngine({
        cashReservePct: 1.0,
        maxNotionalExposureUsd: 1e12, maxPositionSizeUsd: 1e12, allowShortSelling: true,
      });
      const result = engine.check(
        makeIntent({ side: 'sell', qty: 10 }),
        makePortfolio({ cash: 1_000, equity: 1_000, positions: [] }),
        100,
      );
      expect(result.passed).toBe(false);
      expect(result.failedCheck).toBe('CASH_RESERVE');
    });

    it('allows a sell opening a short when cash is above the reserve floor', () => {
      // cash=10,000, equity=10,000, 10% reserve → floor=$1,000.
      // cash $10,000 > floor $1,000 → not blocked.
      const engine = new RiskEngine({
        cashReservePct: 0.10,
        maxNotionalExposureUsd: 1e12, maxPositionSizeUsd: 1e12, allowShortSelling: true,
      });
      const result = engine.check(
        makeIntent({ side: 'sell', qty: 10 }),
        makePortfolio({ cash: 10_000, equity: 10_000, positions: [] }),
        100,
      );
      expect(result.failedCheck).not.toBe('CASH_RESERVE');
    });
  });

  describe('intraday drawdown engages kill switch', () => {
    it('engages kill switch when drawdown breaches limit', () => {
      const engine = new RiskEngine({ maxIntradayDrawdownPct: 0.05 });
      // First check: session start equity = 100,000.
      engine.check(makeIntent({ id: 'a', strategyId: 'A' }), makePortfolio({ equity: 100_000 }));
      // Subsequent check: equity has dropped to 90,000 → 10% drawdown > 5% limit.
      const result = engine.check(
        makeIntent({ id: 'b', strategyId: 'B' }),
        makePortfolio({ equity: 90_000 }),
      );
      expect(result.passed).toBe(false);
      expect(result.failedCheck).toBe('INTRADAY_DRAWDOWN');
      // Kill switch should now be engaged.
      expect(engine.getConfig().killSwitchActive).toBe(true);
    });

    it('does not trip below the configured threshold', () => {
      const engine = new RiskEngine({ maxIntradayDrawdownPct: 0.10 });
      engine.check(makeIntent({ id: 'a', strategyId: 'A' }), makePortfolio({ equity: 100_000 }));
      const result = engine.check(
        makeIntent({ id: 'b', strategyId: 'B' }),
        makePortfolio({ equity: 95_000 }), // 5% drawdown < 10%
      );
      expect(result.failedCheck).not.toBe('INTRADAY_DRAWDOWN');
    });
  });

  describe('concentration limit', () => {
    it('rejects an order that would put the symbol over the concentration limit', () => {
      const engine = new RiskEngine({
        maxConcentrationPct: 0.25, // no symbol > 25% of equity
        maxNotionalExposureUsd: 1e12, maxPositionSizeUsd: 1e12,
        cashReservePct: 0,
      });
      // Equity=100,000. Order would put SPY at 100 shares * $500 = $50,000 = 50% > 25%.
      const result = engine.check(
        makeIntent({ qty: 100 }),
        makePortfolio({ cash: 100_000, equity: 100_000 }),
        500,
      );
      expect(result.passed).toBe(false);
      expect(result.failedCheck).toBe('CONCENTRATION_LIMIT');
    });

    it('allows an order that stays under the limit', () => {
      const engine = new RiskEngine({
        maxConcentrationPct: 0.50, maxNotionalExposureUsd: 1e12,
        maxPositionSizeUsd: 1e12, cashReservePct: 0,
      });
      // Order: 50 shares * $500 = $25,000 = 25% < 50%.
      const result = engine.check(
        makeIntent({ qty: 50 }),
        makePortfolio({ cash: 100_000, equity: 100_000 }),
        500,
      );
      expect(result.passed).toBe(true);
    });
  });

  describe('max position size uses reference price when no limit price is set', () => {
    it('rejects a market order whose notional would exceed maxPositionSizeUsd', () => {
      const engine = new RiskEngine({
        maxPositionSizeUsd: 1_000, maxNotionalExposureUsd: 1e12,
        cashReservePct: 0,
      });
      // Existing pos 10 shares; order +10 more @ $100 → newQty=20 * $100 = $2,000 > $1,000.
      const position = makePosition({ qty: 10, currentPrice: 100 });
      const result = engine.check(
        makeIntent({ qty: 10 }),
        makePortfolio({ positions: [position] }),
        100,
      );
      expect(result.passed).toBe(false);
      expect(result.failedCheck).toBe('MAX_POSITION_SIZE');
    });
  });
});

// ---------------------------------------------------------------------------
// Cash reserve fix: short sale proceeds inflate portfolio.cash above equity
// ---------------------------------------------------------------------------
describe('RiskEngine: cash reserve fix — short proceeds must not bypass reserve', () => {
  it('blocks a buy when cash > equity due to short proceeds with full reserve', () => {
    // Short sale inflates cash to $200k while equity stays at $100k.
    // A 100% reserve should leave $0 available for new buys.
    // Before fix: spendable=cash=200k, floor=equity*1.0=100k → available=100k → BUY PASSES (bug)
    // After fix:  spendable=min(cash,equity)=100k, floor=100k → available=0 → BUY BLOCKED (correct)
    const engine = new RiskEngine({
      cashReservePct: 1.0,
      maxNotionalExposureUsd: 1e12, maxPositionSizeUsd: 1e12,
      maxIntradayDrawdownPct: undefined, allowShortSelling: true,
    });
    const result = engine.check(
      makeIntent({ side: 'buy', qty: 1 }),
      makePortfolio({ cash: 200_000, equity: 100_000 }),
      1, // cost = $1, would pass if available cash is wrongly inflated
    );
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe('CASH_RESERVE');
  });

  it('allows a buy when cash equals equity (no short inflation)', () => {
    // Normal case: cash == equity, 5% reserve → available = $95k, order = $1k → passes
    const engine = new RiskEngine({
      cashReservePct: 0.05,
      maxNotionalExposureUsd: 1e12, maxPositionSizeUsd: 1e12,
      maxIntradayDrawdownPct: undefined, maxConcentrationPct: 1.0,
    });
    const result = engine.check(
      makeIntent({ side: 'buy', qty: 10 }),
      makePortfolio({ cash: 100_000, equity: 100_000 }),
      100,
    );
    expect(result.passed).toBe(true);
  });

  it('blocks a buy even with moderate short inflation and partial reserve', () => {
    // Equity=$50k, cash=$90k (short proceeds), 10% reserve → floor=$5k,
    // spendable=min(90k,50k)=50k → available=45k; order=100*$500=$50k > $45k → blocked
    const engine = new RiskEngine({
      cashReservePct: 0.10,
      maxNotionalExposureUsd: 1e12, maxPositionSizeUsd: 1e12,
      maxIntradayDrawdownPct: undefined, allowShortSelling: true,
    });
    const result = engine.check(
      makeIntent({ side: 'buy', qty: 100 }),
      makePortfolio({ cash: 90_000, equity: 50_000 }),
      500,
    );
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe('CASH_RESERVE');
  });
});
