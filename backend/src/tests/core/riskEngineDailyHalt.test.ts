jest.mock('../../config/env', () => ({
  env: { maxPositionSizeUsd: 1_000_000, maxNotionalExposureUsd: 10_000_000, orderCooldownMs: 0 },
}));

import { RiskEngine } from '../../core/risk/riskEngine';
import type { OrderIntent } from '../../types/orders';
import type { PortfolioRiskView } from '../../types/portfolio';

const base = { gapBufferBps: 0, spreadBufferBps: 0, orderCooldownMs: 0, staleQuoteThresholdMs: 0, maxIntradayDrawdownPct: undefined };

function intent(side: 'buy' | 'sell'): OrderIntent {
  return { id: 'i', strategyId: 's', symbol: 'SPY', side, qty: 1, orderType: 'market', timeInForce: 'day', ts: 0 };
}
const pf = (equity: number): PortfolioRiskView => ({ equity, cash: equity, positions: [], initialCapital: 100_000 });

describe('RiskEngine daily halt (dailyHaltPct)', () => {
  it('is inert when dailyHaltPct is unset', () => {
    const r = new RiskEngine({ ...base });
    r.check(intent('buy'), pf(100_000), 100);
    expect(r.check(intent('buy'), pf(50_000), 100).passed).toBe(true);
  });

  it('blocks buys at a 1% fall from session-start equity, still allows sells, and latches', () => {
    const r = new RiskEngine({ ...base, dailyHaltPct: 0.01 });
    expect(r.check(intent('buy'), pf(100_000), 100).passed).toBe(true); // sets session start
    expect(r.check(intent('buy'), pf(99_100), 100).passed).toBe(true); // 0.9%
    const hit = r.check(intent('buy'), pf(99_000), 100); // 1.0%
    expect(hit.passed).toBe(false);
    expect(hit.failedCheck).toBe('DAILY_HALT');
    expect(r.check(intent('sell'), pf(99_000), 100).failedCheck).not.toBe('DAILY_HALT');
    expect(r.isKillSwitchActive()).toBe(false);
    // equity recovering does not re-open entries within the session
    expect(r.check(intent('buy'), pf(100_000), 100).failedCheck).toBe('DAILY_HALT');
  });

  it('resetSession clears the latch', () => {
    const r = new RiskEngine({ ...base, dailyHaltPct: 0.01 });
    r.check(intent('buy'), pf(100_000), 100);
    r.check(intent('buy'), pf(98_000), 100);
    r.resetSession();
    expect(r.check(intent('buy'), pf(98_000), 100).passed).toBe(true);
  });
});
