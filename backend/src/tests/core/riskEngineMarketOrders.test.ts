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
