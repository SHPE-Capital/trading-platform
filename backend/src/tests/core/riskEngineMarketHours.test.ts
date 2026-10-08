jest.mock('../../utils/time');

import * as time from '../../utils/time';
import { RiskEngine } from '../../core/risk/riskEngine';
import type { OrderIntent } from '../../types/orders';
import type { PortfolioSnapshot } from '../../types/portfolio';

const mockNowMs = time.nowMs as jest.Mock;

const intent: OrderIntent = {
  id: 'intent-1', strategyId: 'strat-1', symbol: 'F', side: 'buy', qty: 1,
  orderType: 'market', timeInForce: 'day', ts: 10_000,
};

const portfolio: PortfolioSnapshot = {
  id: 'snap', ts: 10_000, cash: 100_000, equity: 100_000, positions: [],
  totalUnrealizedPnl: 0, totalRealizedPnl: 0, totalPnl: 0, grossExposure: 0, netExposure: 0,
} as unknown as PortfolioSnapshot;

beforeEach(() => mockNowMs.mockReturnValue(10_000));

describe('RiskEngine MARKET_CLOSED', () => {
  it('rejects while the market is closed', () => {
    const engine = new RiskEngine();
    engine.setMarketHours({ isOpen: () => false });
    const result = engine.check(intent, portfolio, 12);
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe('MARKET_CLOSED');
  });

  it('passes while the market is open', () => {
    const engine = new RiskEngine();
    engine.setMarketHours({ isOpen: () => true });
    expect(engine.check(intent, portfolio, 12).passed).toBe(true);
  });

  it('skips the check when no calendar is set (backtests)', () => {
    expect(new RiskEngine().check(intent, portfolio, 12).passed).toBe(true);
  });

  it('asks the calendar about the check time', () => {
    const isOpen = jest.fn(() => true);
    const engine = new RiskEngine();
    engine.setMarketHours({ isOpen });
    mockNowMs.mockReturnValue(42_000);
    engine.check(intent, portfolio, 12);
    expect(isOpen).toHaveBeenCalledWith(42_000);
  });
});
