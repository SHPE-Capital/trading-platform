jest.mock('../../config/env', () => ({
  env: {
    logLevel: 'error', alpacaDataKey: '', alpacaDataSecret: '',
    alpacaApiKey: 'paper-test-key', alpacaApiSecret: 'paper-test-secret',
    alpacaPaperBaseUrl: 'https://paper-api.alpaca.markets',
    maxPositionSizeUsd: 10_000, maxNotionalExposureUsd: 50_000, orderCooldownMs: 5_000,
  },
}));

import { AlpacaOrderExecutionAdapter } from '../../adapters/alpaca/orderExecution';
import { ReplayBarFeed } from '../../adapters/replay/replayBarFeed';
import { STRATEGY_DEFINITIONS, STRATEGY_FACTORY } from '../../config/strategyDefaults';
import { BacktestEngine } from '../../core/backtest/backtestEngine';
import { BacktestLoader } from '../../core/backtest/backtestLoader';
import type { BarCache } from '../../core/backtest/barCache';
import { buildBacktestStrategies } from '../../core/backtest/strategyFactory';
import { EventBus } from '../../core/engine/eventBus';
import { Orchestrator } from '../../core/engine/orchestrator';
import { ExecutionEngine } from '../../core/execution/executionEngine';
import { JournaledExecutionSink } from '../../core/execution/journaledExecution';
import { PaperExecutionSink } from '../../core/execution/paperExecution';
import { SimulatedExecutionSink } from '../../core/execution/simulatedExecution';
import { RiskEngine } from '../../core/risk/riskEngine';
import { OrderStateManager } from '../../core/state/orderState';
import { PortfolioStateManager } from '../../core/state/portfolioState';
import { SymbolStateManager } from '../../core/state/symbolState';
import type { BacktestConfig } from '../../types/backtest';
import type { BarReceivedEvent, OrderFilledEvent, RiskRejectedEvent } from '../../types/events';
import type { Bar } from '../../types/market';
import { newId } from '../../utils/ids';

const MINUTE = 60_000;
const T0 = Date.parse('2024-01-02T15:00:00Z');
const definition = STRATEGY_DEFINITIONS.beginner_reversal;

function barsFor(symbol: string): Bar[] {
  return [100, 99, 98, 99, 100, 99, 99, 99].map((close, i) => ({
    symbol, ts: T0 + i * MINUTE, isoTs: new Date(T0 + i * MINUTE).toISOString(),
    open: close, high: close, low: close, close, volume: 100_000, timeframe: '1Min',
  }));
}

function courseCache(): BarCache {
  return {
    getCompleteDays: async () => new Set(['2024-01-02']),
    readBars: async (symbol, _timeframe, start, end) => barsFor(symbol).filter((b) => b.ts >= start && b.ts < end),
    writeBars: async () => {},
    markComplete: async () => {},
  };
}

describe('course default strategy through the trading pipelines', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('Unexpected network request'));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('backtests both default symbols from cache without keys, respects caps, and fills on later bars', async () => {
    const config: BacktestConfig = {
      id: newId(), name: 'Course default verification',
      strategyConfig: STRATEGY_FACTORY.beginner_reversal(definition.defaultConfig).config,
      strategyVersion: definition.algorithmVersion,
      startDate: new Date(T0).toISOString(), endDate: new Date(T0 + 8 * MINUTE).toISOString(),
      initialCapital: 100_000, dataGranularity: 'bar', slippageBps: 5, commissionPerShare: 0.005,
    };
    const result = await new BacktestEngine(new BacktestLoader({ cache: courseCache() }))
      .run(config, () => buildBacktestStrategies(config));

    expect(result.event_count).toBe(16);
    for (const symbol of ['SPY', 'AAPL']) {
      const fills = result.fills!.filter((f) => f.symbol === symbol);
      expect(fills.map((f) => f.side)).toEqual(['buy', 'sell', 'sell', 'buy']);
      expect(fills.every((f) => f.qty === 1)).toBe(true);
    }
    for (const fill of result.fills!) {
      const order = result.orders!.find((o) => o.id === fill.orderId)!;
      expect(fill.ts).toBeGreaterThanOrEqual(order.submittedAt);
      // The first decision follows the second close, so it can only fill at bar 3.
      expect(fill.ts).toBeGreaterThanOrEqual(T0 + 2 * MINUTE);
    }
    expect(result.final_portfolio.positions.every((p) => p.qty === 0)).toBe(true);
    expect(result.final_portfolio.equity).toBeCloseTo(result.final_portfolio.cash, 8);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('launches the default strategy after an empty replay boot and journals/fills local paper orders', async () => {
    jest.useFakeTimers({ now: T0 + 365 * 24 * 60 * MINUTE });
    const bus = new EventBus();
    const symbols = new SymbolStateManager();
    const portfolio = new PortfolioStateManager(100_000);
    const orders = new OrderStateManager();
    const sim = new SimulatedExecutionSink(bus, symbols, 'paper', 5, 0.005, {});
    const journal = { recordPending: jest.fn().mockResolvedValue(undefined), recordSendFailed: jest.fn() };
    const submit = jest.spyOn(sim, 'submitOrder');
    const orchestrator = new Orchestrator(bus, symbols, portfolio, orders, new RiskEngine(),
      new ExecutionEngine(new JournaledExecutionSink(sim, journal)), 'paper');
    const rejections: RiskRejectedEvent[] = [];
    const fills: OrderFilledEvent[] = [];
    bus.on('RISK_REJECTED', (e) => { rejections.push(e as RiskRejectedEvent); });
    bus.on('ORDER_FILLED', (e) => { fills.push(e as OrderFilledEvent); });
    const feed = new ReplayBarFeed(bus, 'paper', courseCache(), { fromMs: T0, toMs: T0 + 8 * MINUTE, speed: 1 });

    orchestrator.start();
    await feed.connect(); // A new platform has no runs at boot.
    const strategy = STRATEGY_FACTORY.beginner_reversal({ ...definition.defaultConfig, id: newId() });
    orchestrator.registerStrategy(strategy, 'course-run');
    feed.subscribe(strategy.config.symbols);
    try {
      await jest.advanceTimersByTimeAsync(8 * MINUTE);
      expect(rejections).toEqual([]);
      expect(fills).toHaveLength(8);
      expect(journal.recordPending).toHaveBeenCalledTimes(8);
      expect(submit).toHaveBeenCalledTimes(8);
      expect(journal.recordPending.mock.invocationCallOrder[0]).toBeLessThan(submit.mock.invocationCallOrder[0]);
      expect(orders.getOpenOrders()).toHaveLength(0);
      expect(orchestrator.reservedCapital).toBe(0);
      expect(portfolio.getAllPositions().every((p) => p.qty === 0)).toBe(true);
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      feed.disconnect();
      orchestrator.stop();
    }
  });

  it('routes a course signal through risk and journaling to the Alpaca paper adapter', async () => {
    jest.useFakeTimers({ now: T0 });
    const bus = new EventBus();
    const symbols = new SymbolStateManager();
    const portfolio = new PortfolioStateManager(100_000);
    const orders = new OrderStateManager();
    const journal = { recordPending: jest.fn().mockResolvedValue(undefined), recordSendFailed: jest.fn() };
    const adapter = new AlpacaOrderExecutionAdapter(bus, 'paper');
    const orchestrator = new Orchestrator(bus, symbols, portfolio, orders, new RiskEngine(),
      new ExecutionEngine(new JournaledExecutionSink(new PaperExecutionSink(adapter), journal)), 'paper');
    (global.fetch as jest.Mock).mockImplementation(async (_url: string, init: RequestInit) => {
      expect(journal.recordPending).toHaveBeenCalledTimes(1);
      const body = JSON.parse(init.body as string);
      return { ok: true, json: async () => ({
        ...body, id: 'paper-order', status: 'new', filled_qty: '0', submitted_at: new Date().toISOString(),
      }) };
    });
    orchestrator.registerStrategy(STRATEGY_FACTORY.beginner_reversal({ ...definition.defaultConfig, id: newId() }), 'course-run');
    orchestrator.start();
    try {
      for (const bar of barsFor('SPY').slice(0, 2)) {
        jest.setSystemTime(bar.ts + MINUTE);
        bus.publish({ id: newId(), type: 'BAR_RECEIVED', mode: 'paper', ts: Date.now(), payload: bar } as BarReceivedEvent);
      }
      await jest.advanceTimersByTimeAsync(0);
      expect(global.fetch).toHaveBeenCalledWith('https://paper-api.alpaca.markets/v2/orders', expect.objectContaining({
        method: 'POST', body: expect.any(String),
      }));
      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body).toMatchObject({ symbol: 'SPY', side: 'buy', qty: '1', type: 'market' });
      expect(orders.getOpenOrders()).toHaveLength(1);
      expect(orders.getOpenOrders()[0]).toMatchObject({ runId: 'course-run', brokerOrderId: 'paper-order' });
      // A submitted paper order remains unfilled until the broker reports a fill.
      expect(portfolio.getPosition('SPY')?.qty ?? 0).toBe(0);
    } finally {
      orchestrator.stop();
      adapter.disconnect();
    }
  });
});
