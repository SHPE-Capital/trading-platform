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

/**
 * The live runtimes build their RiskEngine from DEFAULT_RISK_CONFIG, whose
 * order cooldown (5 s) was keyed per strategy. Bars for every symbol arrive in
 * the same instant, and a pair's legs are dispatched back to back, so all but
 * the first order of each burst were rejected as ORDER_COOLDOWN. Backtests
 * never saw it: BACKTEST_RISK_CONFIG zeroes the cooldown.
 */

import { EventBus } from '../../core/engine/eventBus';
import { Orchestrator } from '../../core/engine/orchestrator';
import { SymbolStateManager } from '../../core/state/symbolState';
import { PortfolioStateManager } from '../../core/state/portfolioState';
import { OrderStateManager } from '../../core/state/orderState';
import { RiskEngine } from '../../core/risk/riskEngine';
import { ExecutionEngine } from '../../core/execution/executionEngine';
import { MinuteReversalStrategy } from '../../strategies/minuteReversal/minuteReversalStrategy';
import { createMinuteReversalConfig } from '../../strategies/minuteReversal/minuteReversalConfig';
import type { IExecutionSink } from '../../core/execution/IExecutionSink';
import type { OrderIntent } from '../../types/orders';
import type { RiskRejectedEvent } from '../../types/events';

const SYMBOLS = ['NVDA', 'AAPL', 'MSFT', 'MU', 'AMD', 'AMZN', 'META', 'GOOGL', 'SPCX', 'TSLA'];

function makeLiveOrch() {
  const submitted: OrderIntent[] = [];
  const sink: IExecutionSink = {
    submitOrder: async (intent) => { submitted.push(intent); return {} as never; },
    cancelOrder: async () => undefined,
  };
  const bus = new EventBus();
  const orch = new Orchestrator(
    bus, new SymbolStateManager(), new PortfolioStateManager(100_000),
    new OrderStateManager(), new RiskEngine(), // DEFAULT_RISK_CONFIG, as bootstrap.ts uses
    new ExecutionEngine(sink), 'paper',
  );
  const rejected: RiskRejectedEvent[] = [];
  bus.on('RISK_REJECTED', (e) => { rejected.push(e as RiskRejectedEvent); });
  return { bus, orch, submitted, rejected };
}

function publishBars(bus: EventBus, ts: number, closeFor: (i: number) => number) {
  SYMBOLS.forEach((symbol, i) => {
    const close = closeFor(i);
    bus.publish({
      id: `b-${symbol}-${ts}`, type: 'BAR_RECEIVED', ts: Date.now(), mode: 'paper',
      payload: { symbol, open: close, high: close, low: close, close, volume: 1, ts, isoTs: new Date(ts).toISOString(), timeframe: '1m' },
    } as never);
    // A fresh quote, so the stale-quote check sees live data as it would in production.
    bus.publish({
      id: `q-${symbol}-${ts}`, type: 'QUOTE_RECEIVED', ts: Date.now(), mode: 'paper',
      payload: {
        symbol, bidPrice: close - 0.01, askPrice: close + 0.01, bidSize: 1, askSize: 1,
        midPrice: close, spread: 0.02, microPrice: close, imbalance: 0, ts: Date.now(), isoTs: new Date().toISOString(),
      },
    } as never);
  });
}

describe('live order cooldown across symbols', () => {
  it('lets every symbol of a multi-symbol strategy trade the same bar', async () => {
    const { bus, orch, submitted, rejected } = makeLiveOrch();
    // Bars are stamped with the wall clock below, so the session guard is off
    // to keep the test independent of when it runs.
    orch.registerStrategy(new MinuteReversalStrategy(createMinuteReversalConfig({
      id: 'mr', symbols: SYMBOLS, regularHoursOnly: false,
    })), 'run-1');
    orch.start();

    const minute = Math.floor(Date.now() / 60_000) * 60_000;
    publishBars(bus, minute - 120_000, (i) => 100 + i);       // baseline
    publishBars(bus, minute - 60_000, (i) => 100 + i + (i % 2 ? 1 : -1)); // half up, half down
    await new Promise((r) => setImmediate(r));

    expect(rejected.map((e) => e.failedCheck)).toEqual([]);
    expect(submitted.map((o) => o.symbol).sort()).toEqual([...SYMBOLS].sort());
    expect(submitted.filter((o) => o.side === 'sell')).toHaveLength(5);
  });

  it('submits both legs of a pairs signal', async () => {
    const { bus, orch, submitted, rejected } = makeLiveOrch();
    orch.start();
    for (const [symbol, px] of [['SPY', 700], ['QQQ', 600]] as const) {
      bus.publish({
        id: `q-${symbol}`, type: 'QUOTE_RECEIVED', ts: Date.now(), mode: 'paper',
        payload: {
          symbol, bidPrice: px, askPrice: px, bidSize: 1, askSize: 1, midPrice: px, spread: 0,
          microPrice: px, imbalance: 0, ts: Date.now(), isoTs: new Date().toISOString(),
        },
      } as never);
    }
    bus.publish({
      id: 'sig', type: 'STRATEGY_SIGNAL_CREATED', ts: Date.now(), mode: 'paper', strategyId: 'pairs',
      payload: {
        strategyId: 'pairs', symbol: 'SPY', direction: 'long', qty: 3, triggerLabel: 'entry',
        meta: { counterpartSymbol: 'QQQ', counterpartDirection: 'short', hedgeRatio: 1 },
      },
    } as never);
    await new Promise((r) => setImmediate(r));

    expect(rejected).toEqual([]);
    expect(submitted.map((o) => `${o.side} ${o.symbol}`).sort()).toEqual(['buy SPY', 'sell QQQ']);
  });
});
