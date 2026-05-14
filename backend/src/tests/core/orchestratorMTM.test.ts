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

import { EventBus } from '../../core/engine/eventBus';
import { Orchestrator } from '../../core/engine/orchestrator';
import { SymbolStateManager } from '../../core/state/symbolState';
import { PortfolioStateManager } from '../../core/state/portfolioState';
import { OrderStateManager } from '../../core/state/orderState';
import { RiskEngine } from '../../core/risk/riskEngine';
import { ExecutionEngine } from '../../core/execution/executionEngine';
import { SimulatedExecutionSink } from '../../core/execution/simulatedExecution';
import type { Bar, Quote, Trade } from '../../types/market';
import type { Fill } from '../../types/orders';

function makeBar(symbol: string, ts: number, open: number, close: number): Bar {
  return {
    symbol, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1,
    close, volume: 1_000, ts, isoTs: new Date(ts).toISOString(), timeframe: '1Min',
  };
}

function makeFixture(initialCapital = 100_000) {
  const eventBus = new EventBus();
  const symbolState = new SymbolStateManager();
  const portfolioState = new PortfolioStateManager(initialCapital);
  const orderState = new OrderStateManager();
  const riskEngine = new RiskEngine({});
  const sink = new SimulatedExecutionSink(eventBus, symbolState, 'backtest', 0, 0);
  const executionEngine = new ExecutionEngine(sink);
  const orch = new Orchestrator(eventBus, symbolState, portfolioState, orderState, riskEngine, executionEngine, 'backtest');
  orch.start();
  return { eventBus, symbolState, portfolioState, orch };
}

describe('Orchestrator: mark-to-market on every bar/quote/trade (fix #3)', () => {
  it('equity changes across bars when price moves and there are no new fills', () => {
    const { eventBus, portfolioState } = makeFixture(100_000);

    // Seed a long position via a buy fill at 100.
    const fill: Fill = {
      id: 'f1', orderId: 'o1', symbol: 'SPY', side: 'buy', qty: 10, price: 100,
      notional: 1_000, commission: 0, ts: 1_000, isoTs: '',
    };
    portfolioState.applyFill(fill);
    const baselineEquity = portfolioState.getSnapshot().equity;
    expect(baselineEquity).toBe(100_000); // cash -1000 + position 1000

    // Bar arrives with close=120 — should mark the position to 120.
    eventBus.publish({
      id: 'b1', type: 'BAR_RECEIVED', ts: 2_000, mode: 'backtest',
      payload: makeBar('SPY', 2_000, 110, 120),
    });

    const snap = portfolioState.getSnapshot();
    // Unrealized PnL = (120 - 100) * 10 = 200; equity = baseline + 200.
    expect(snap.totalUnrealizedPnl).toBeCloseTo(200, 6);
    expect(snap.equity).toBeCloseTo(baselineEquity + 200, 6);

    // Next bar close=90 — position re-marked downward.
    eventBus.publish({
      id: 'b2', type: 'BAR_RECEIVED', ts: 3_000, mode: 'backtest',
      payload: makeBar('SPY', 3_000, 95, 90),
    });
    const snap2 = portfolioState.getSnapshot();
    expect(snap2.totalUnrealizedPnl).toBeCloseTo(-100, 6);
    expect(snap2.equity).toBeCloseTo(baselineEquity - 100, 6);
  });

  it('peak/drawdown reflects mark-to-market between bars', () => {
    const { eventBus, portfolioState } = makeFixture(100_000);

    portfolioState.applyFill({
      id: 'f', orderId: 'o', symbol: 'SPY', side: 'buy', qty: 100, price: 50,
      notional: 5_000, commission: 0, ts: 0, isoTs: '',
    });

    const equityHistory: number[] = [];
    for (const [ts, close] of [
      [1, 50], [2, 60], [3, 70], [4, 65], [5, 40],
    ] as Array<[number, number]>) {
      eventBus.publish({
        id: `b${ts}`, type: 'BAR_RECEIVED', ts, mode: 'backtest',
        payload: makeBar('SPY', ts, close, close),
      });
      equityHistory.push(portfolioState.getSnapshot().equity);
    }

    // Position 100 shares from 50: equity at each close = cash + 100*close
    // cash after entry = 100000 - 5000 = 95000
    expect(equityHistory[0]).toBeCloseTo(95_000 + 100 * 50, 4);
    expect(equityHistory[2]).toBeCloseTo(95_000 + 100 * 70, 4); // peak
    expect(equityHistory[4]).toBeCloseTo(95_000 + 100 * 40, 4); // trough

    // Equity moved without any new fills — proves MTM is wired through bars.
    expect(equityHistory[2]).toBeGreaterThan(equityHistory[0]);
    expect(equityHistory[4]).toBeLessThan(equityHistory[2]);
  });

  it('quote events also drive mark-to-market', () => {
    const { eventBus, portfolioState } = makeFixture(100_000);

    portfolioState.applyFill({
      id: 'f', orderId: 'o', symbol: 'SPY', side: 'buy', qty: 10, price: 100,
      notional: 1_000, commission: 0, ts: 0, isoTs: '',
    });

    const quote: Quote = {
      symbol: 'SPY', bidPrice: 99, askPrice: 101, bidSize: 100, askSize: 100,
      midPrice: 100, spread: 2, microPrice: 100, imbalance: 0,
      ts: 1_000, isoTs: '',
    };

    eventBus.publish({ id: 'q1', type: 'QUOTE_RECEIVED', ts: 1_000, mode: 'paper', payload: quote });
    const snap1 = portfolioState.getSnapshot();
    expect(snap1.totalUnrealizedPnl).toBe(0); // still at 100

    // Mid moves to 105
    eventBus.publish({
      id: 'q2', type: 'QUOTE_RECEIVED', ts: 2_000, mode: 'paper',
      payload: { ...quote, bidPrice: 104, askPrice: 106, midPrice: 105, ts: 2_000 },
    });
    expect(portfolioState.getSnapshot().totalUnrealizedPnl).toBeCloseTo(50, 6);
  });

  it('trade events also drive mark-to-market', () => {
    const { eventBus, portfolioState } = makeFixture(100_000);

    portfolioState.applyFill({
      id: 'f', orderId: 'o', symbol: 'SPY', side: 'buy', qty: 10, price: 100,
      notional: 1_000, commission: 0, ts: 0, isoTs: '',
    });

    const trade: Trade = {
      symbol: 'SPY', price: 115, size: 100, ts: 1_000, isoTs: '',
    };
    eventBus.publish({ id: 't1', type: 'TRADE_RECEIVED', ts: 1_000, mode: 'paper', payload: trade });
    expect(portfolioState.getSnapshot().totalUnrealizedPnl).toBeCloseTo(150, 6);
  });
});
