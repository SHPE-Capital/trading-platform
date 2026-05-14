/**
 * simulatedCancellation.test.ts — verifies that the SimulatedExecutionSink
 * supports specific cancellation of queued intents before the next bar
 * delivers a fill.
 */

jest.mock('../../config/env', () => ({
  env: {
    alpacaApiKey: 'k',
    alpacaApiSecret: 's',
    alpacaTradingMode: 'paper',
    alpacaPaperBaseUrl: '',
    alpacaLiveBaseUrl: '',
    alpacaDataStreamUrl: '',
    alpacaPaperStreamUrl: '',
    alpacaLiveStreamUrl: '',
    supabaseUrl: '',
    supabaseAnonKey: '',
    supabaseServiceRoleKey: '',
    port: 8080,
    nodeEnv: 'test',
    corsOrigin: '',
    logLevel: 'error',
    defaultRollingWindowMs: 60_000,
    maxPositionSizeUsd: 10_000,
    maxNotionalExposureUsd: 50_000,
    orderCooldownMs: 5_000,
    enableLiveTrading: false,
    enableWebSocketPush: false,
    databaseUrl: '',
  },
}));

import { EventBus } from '../../core/engine/eventBus';
import { SymbolStateManager } from '../../core/state/symbolState';
import { SimulatedExecutionSink } from '../../core/execution/simulatedExecution';
import type { OrderIntent, Fill } from '../../types/orders';
import type { Bar } from '../../types/market';
import type {
  OrderFilledEvent,
  OrderCanceledEvent,
} from '../../types/events';

function makeIntent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    id: 'i1',
    strategyId: 's1',
    symbol: 'SPY',
    side: 'buy',
    qty: 10,
    orderType: 'market',
    timeInForce: 'ioc',
    ts: 1_000,
    ...overrides,
  };
}

function makeBar(symbol: string, ts: number, open: number, close: number): Bar {
  return {
    symbol,
    open,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    close,
    volume: 10_000,
    ts,
    isoTs: new Date(ts).toISOString(),
    timeframe: '1Min',
  };
}

describe('SimulatedExecutionSink: cancellation of queued intents', () => {
  it('cancelOrder(brokerOrderId) removes the intent from the queue and emits ORDER_CANCELED', async () => {
    const bus = new EventBus();
    const symbolState = new SymbolStateManager();
    const sink = new SimulatedExecutionSink(bus, symbolState, 'backtest', 0, 0);

    const canceled: OrderCanceledEvent[] = [];
    const filled: OrderFilledEvent[] = [];
    bus.on('ORDER_CANCELED', (e) => { canceled.push(e as OrderCanceledEvent); });
    bus.on('ORDER_FILLED', (e) => { filled.push(e as OrderFilledEvent); });

    const order = await sink.submitOrder(makeIntent({ id: 'to-cancel' }));
    expect(sink.pendingCount('SPY')).toBe(1);

    await sink.cancelOrder(order.brokerOrderId!);

    expect(sink.pendingCount('SPY')).toBe(0);
    expect(canceled).toHaveLength(1);
    expect(canceled[0].orderId).toBe('to-cancel');

    // A subsequent bar must NOT fill the canceled order.
    bus.publish({
      id: 'b',
      type: 'BAR_RECEIVED',
      ts: 2_000,
      mode: 'backtest',
      payload: makeBar('SPY', 2_000, 100, 101),
    });
    expect(filled).toHaveLength(0);
  });

  it('cancelOrder accepts the internal order id (no "sim_" prefix)', async () => {
    const bus = new EventBus();
    const sink = new SimulatedExecutionSink(bus, new SymbolStateManager(), 'backtest', 0, 0);
    const canceled: OrderCanceledEvent[] = [];
    bus.on('ORDER_CANCELED', (e) => { canceled.push(e as OrderCanceledEvent); });

    const order = await sink.submitOrder(makeIntent({ id: 'raw-id' }));
    await sink.cancelOrder(order.id);
    expect(canceled).toHaveLength(1);
    expect(canceled[0].orderId).toBe('raw-id');
  });

  it('cancelOrder is a no-op for unknown order ids', async () => {
    const bus = new EventBus();
    const sink = new SimulatedExecutionSink(bus, new SymbolStateManager(), 'backtest', 0, 0);
    const canceled: OrderCanceledEvent[] = [];
    bus.on('ORDER_CANCELED', (e) => { canceled.push(e as OrderCanceledEvent); });

    await expect(sink.cancelOrder('sim_nope')).resolves.toBeUndefined();
    expect(canceled).toHaveLength(0);
  });

  it('cancelOrder only cancels the targeted intent; siblings still fill', async () => {
    const bus = new EventBus();
    const sink = new SimulatedExecutionSink(bus, new SymbolStateManager(), 'backtest', 0, 0);
    const filled: Fill[] = [];
    const canceled: OrderCanceledEvent[] = [];
    bus.on('ORDER_FILLED', (e) => { filled.push((e as OrderFilledEvent).fill); });
    bus.on('ORDER_CANCELED', (e) => { canceled.push(e as OrderCanceledEvent); });

    await sink.submitOrder(makeIntent({ id: 'keep' }));
    const cancelMe = await sink.submitOrder(makeIntent({ id: 'cancel' }));
    expect(sink.pendingCount('SPY')).toBe(2);

    await sink.cancelOrder(cancelMe.brokerOrderId!);
    expect(sink.pendingCount('SPY')).toBe(1);

    bus.publish({
      id: 'b',
      type: 'BAR_RECEIVED',
      ts: 2_000,
      mode: 'backtest',
      payload: makeBar('SPY', 2_000, 100, 101),
    });

    expect(filled).toHaveLength(1);
    expect(filled[0].orderId).toBe('keep');
    expect(canceled).toHaveLength(1);
    expect(canceled[0].orderId).toBe('cancel');
  });
});
