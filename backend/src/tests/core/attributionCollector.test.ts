jest.mock('../../config/env', () => ({ env: { logLevel: 'error' } }));

import { EventBus } from '../../core/engine/eventBus';
import { AttributionCollector } from '../../core/replay/attributionCollector';
import type { TradingEvent } from '../../types/events';

const base = (type: string, ts: number) => ({ id: `${type}-${ts}`, type, ts, mode: 'replay' });

const quote = (symbol: string, bid: number, ask: number, ts: number) =>
  ({ ...base('QUOTE_RECEIVED', ts), payload: { symbol, bidPrice: bid, askPrice: ask } }) as unknown as TradingEvent;
const signal = (signalId: string, strategyId: string, symbol: string, direction: string, ts: number) =>
  ({ ...base('STRATEGY_SIGNAL_CREATED', ts), strategyId, signalId, payload: { id: `p-${signalId}`, symbol, direction } }) as unknown as TradingEvent;
const submitted = (orderId: string, signalId: string, strategyId: string, ts: number) =>
  ({ ...base('ORDER_SUBMITTED', ts), payload: { id: orderId, signalId, strategyId } }) as unknown as TradingEvent;
const filled = (orderId: string, symbol: string, side: 'buy' | 'sell', qty: number, price: number, ts: number) =>
  ({ ...base('ORDER_FILLED', ts), orderId, fill: { orderId, symbol, side, qty, price, ts } }) as unknown as TradingEvent;
const rejected = (signalId: string, strategyId: string, ts: number) =>
  ({ ...base('RISK_REJECTED', ts), strategyId, reason: 'cooldown', rejectedIntent: { symbol: 'SPY', signalId } }) as unknown as TradingEvent;
const portfolio = (equity: number, ts: number) =>
  ({ ...base('PORTFOLIO_UPDATED', ts), payload: { equity } }) as unknown as TradingEvent;

function run(events: TradingEvent[]) {
  const bus = new EventBus();
  const collector = new AttributionCollector(bus);
  collector.start('session-1');
  events.forEach((e) => bus.publish(e));
  return collector;
}

describe('AttributionCollector', () => {
  it('reports zeros, not NaN, for an empty session', () => {
    const a = run([]).getAttribution();
    expect(a).toMatchObject({
      sessionId: 'session-1', totalSignals: 0, fillRate: 0, winRate: 0,
      avgSlippageBps: 0, avgHoldingTimeMs: 0, maxDrawdown: 0, totalRealizedPnl: 0,
    });
  });

  it('attributes a long round trip and a rejected signal', () => {
    const a = run([
      quote('SPY', 99.9, 100.1, 1_000),                 // mid 100
      signal('s1', 'strat-A', 'SPY', 'long', 1_000),
      submitted('o1', 's1', 'strat-A', 1_000),
      filled('o1', 'SPY', 'buy', 10, 100.05, 1_100),    // 5 bps worse than mid
      portfolio(100_000, 1_100),
      quote('SPY', 101.9, 102.1, 61_000),
      signal('s2', 'strat-A', 'SPY', 'close_long', 61_000),
      submitted('o2', 's2', 'strat-A', 61_000),
      filled('o2', 'SPY', 'sell', 10, 102, 61_100),
      portfolio(100_019.5, 61_100),
      signal('s3', 'strat-A', 'SPY', 'long', 62_000),
      rejected('s3', 'strat-A', 62_000),
    ]).getAttribution();

    const [s1, s2, s3] = a.signals;
    expect(s1).toMatchObject({ signalMidPrice: 100, fillPrice: 100.05, fillTs: 1_100, outcome: 'filled', holdingTimeMs: 60_000 });
    expect(s1.slippageBps).toBeCloseTo(5);
    expect(s1.realizedPnl).toBeCloseTo(19.5);
    expect(s2).toMatchObject({ outcome: 'filled', realizedPnl: null, signalMidPrice: 102 });
    expect(s2.slippageBps).toBeCloseTo(0);
    expect(s3.outcome).toBe('risk_rejected');

    expect(a.totalSignals).toBe(3);
    expect(a.filledSignals).toBe(2);
    expect(a.fillRate).toBeCloseTo(2 / 3);
    expect(a.winRate).toBe(1);
    expect(a.totalRealizedPnl).toBeCloseTo(19.5);
    expect(a.avgHoldingTimeMs).toBe(60_000);
    expect(a.equityCurve).toHaveLength(2);
    expect(a.byStrategy['strat-A']).toMatchObject({ totalSignals: 3, filledSignals: 2, winRate: 1 });
  });

  it('closes short lots FIFO and credits partial closes to the opener', () => {
    const a = run([
      signal('s1', 'strat-B', 'QQQ', 'short', 0),
      submitted('o1', 's1', 'strat-B', 0),
      filled('o1', 'QQQ', 'sell', 10, 50, 0),
      signal('s2', 'strat-B', 'QQQ', 'close_short', 10),
      submitted('o2', 's2', 'strat-B', 10),
      filled('o2', 'QQQ', 'buy', 4, 48, 10),
      filled('o2', 'QQQ', 'buy', 6, 51, 20),
    ]).getAttribution();
    // +4×2 then −6×1
    expect(a.signals[0].realizedPnl).toBeCloseTo(2);
    expect(a.signals[0].holdingTimeMs).toBe(20);
    expect(a.signals[1].fillPrice).toBeCloseTo((4 * 48 + 6 * 51) / 10);
  });

  it('measures max drawdown from peak to trough', () => {
    const a = run([portfolio(100, 1), portfolio(120, 2), portfolio(90, 3), portfolio(130, 4)]).getAttribution();
    expect(a.maxDrawdown).toBeCloseTo(0.25);
  });

  it('start discards the previous session and stop unsubscribes', () => {
    const bus = new EventBus();
    const collector = new AttributionCollector(bus);
    collector.start('a');
    bus.publish(signal('s1', 'x', 'SPY', 'long', 1));
    collector.start('b');
    expect(collector.getAttribution()).toMatchObject({ sessionId: 'b', totalSignals: 0 });
    collector.stop();
    bus.publish(signal('s2', 'x', 'SPY', 'long', 2));
    expect(collector.getAttribution().totalSignals).toBe(0);
    expect(bus.handlerCount()).toBe(0);
  });
});
