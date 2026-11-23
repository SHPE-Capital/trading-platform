import { TEAM3_BASELINES, universeOf } from '../../../strategies/team3Reversal/contract/protocol';
import { pairRoundTrips } from '../../../runtime/team3Metrics/trades';
import { mechanismMetrics } from '../../../runtime/team3Metrics';
import type { StrategySignal } from '../../../types/strategy';

describe('universeOf: which frozen baseline a run is compared to', () => {
  it('reads Core and Momentum, including subsets such as Core without SPY/QQQ', () => {
    expect(universeOf(['SPY', 'QQQ', 'AAPL', 'MSFT', 'GOOGL', 'AMZN'])).toBe('core');
    expect(universeOf(['AAPL', 'MSFT', 'GOOGL', 'AMZN'])).toBe('core');
    expect(universeOf(['NVDA', 'AMD', 'MU', 'TSLA', 'META'])).toBe('momentum');
  });
  it('refuses ambiguous or mixed symbol lists', () => {
    expect(universeOf(['SPY'])).toBeNull();
    expect(universeOf(['AAPL', 'NVDA'])).toBeNull();
    expect(universeOf([])).toBeNull();
  });
  it('baselines are A03 (Core) and A04 (Momentum)', () => {
    expect(TEAM3_BASELINES).toEqual({ core: '1872fd42-331a-4a8c-a488-460231ac8552', momentum: '4b060cbe-2834-4996-8b6b-c223bef772ed' });
  });
});

const sig = (symbol: string, ts: number, direction: StrategySignal['direction'], meta: Record<string, unknown>): StrategySignal =>
  ({ id: `${symbol}${ts}`, strategyId: 's', strategyType: 'team3_reversal', symbol, direction, qty: 10, ts, meta } as StrategySignal);

describe('pairRoundTrips: enter + next exit per symbol', () => {
  it('pairs by symbol, keeps interleaved symbols apart, drops an unclosed entry', () => {
    const trips = pairRoundTrips([
      sig('AAPL', 1, 'short', { kind: 'enter', close: 101, vwapZ: 2.2, edgeBps: 30, qtyWanted: 10 }),
      sig('MSFT', 2, 'long', { kind: 'enter', close: 50, vwapZ: -2.1, edgeBps: 20, qtyWanted: 12 }),
      sig('AAPL', 5, 'close_short', { kind: 'exit', reason: 'target', barsHeld: 4, pnlBpsGross: 40 }),
      sig('MSFT', 9, 'close_long', { kind: 'exit', reason: 'time', barsHeld: 7, pnlBpsGross: -5 }),
      sig('AAPL', 10, 'short', { kind: 'enter', close: 102, vwapZ: 2.5, edgeBps: 35, qtyWanted: 9 }),
    ]);
    expect(trips).toHaveLength(2);
    expect(trips[0]).toMatchObject({ symbol: 'AAPL', side: 'sell', entryTs: 1, exitTs: 5, reason: 'target', pnlBpsGross: 40, qtyWanted: 10 });
    expect(trips[1]).toMatchObject({ symbol: 'MSFT', side: 'buy', reason: 'time', barsHeld: 7 });
  });
  it('mechanismMetrics is empty while every goal file is a stub', () => {
    expect(mechanismMetrics({ signals: [], roundTrips: [], barsBySymbol: new Map(), daily: [], config: {} })).toEqual({});
  });
});
