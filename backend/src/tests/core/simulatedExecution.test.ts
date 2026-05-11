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
import type { OrderIntent, Order, Fill } from '../../types/orders';
import type { Bar } from '../../types/market';
import type { OrderSubmittedEvent, OrderFilledEvent, OrderRejectedEvent, BarReceivedEvent } from '../../types/events';

function makeIntent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    id: 'intent-1',
    strategyId: 'strat-1',
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
    volume: 1_000,
    ts,
    isoTs: new Date(ts).toISOString(),
    timeframe: '1Min',
  };
}

describe('SimulatedExecutionSink: no same-bar lookahead (fix #1)', () => {
  it('submitOrder returns an unfilled order and does not emit ORDER_FILLED', async () => {
    const bus = new EventBus();
    const symbolState = new SymbolStateManager();
    const sink = new SimulatedExecutionSink(bus, symbolState, 'backtest', 0, 0);

    const fills: OrderFilledEvent[] = [];
    bus.on('ORDER_FILLED', (e) => { fills.push(e as OrderFilledEvent); });

    const order = await sink.submitOrder(makeIntent());
    expect(order.status).toBe('submitted');
    expect(order.filledQty).toBe(0);
    expect(order.avgFillPrice).toBeUndefined();
    expect(order.fills).toHaveLength(0);
    expect(fills).toHaveLength(0);
    expect(sink.pendingCount('SPY')).toBe(1);
  });

  it('fills queued orders at the next bar open price, not the prior bar close', async () => {
    const bus = new EventBus();
    const symbolState = new SymbolStateManager();
    // Sink subscribes to BAR_RECEIVED in its constructor — register before any other listener.
    const sink = new SimulatedExecutionSink(bus, symbolState, 'backtest', 0, 0);

    const fills: OrderFilledEvent[] = [];
    bus.on('ORDER_FILLED', (e) => { fills.push(e as OrderFilledEvent); });

    // Bar N closes at 100. Strategy decides on bar N close → submits.
    const barN = makeBar('SPY', 1_000, /* open */ 99, /* close */ 100);
    symbolState.onBar(barN);

    await sink.submitOrder(makeIntent({ ts: barN.ts }));
    // Still pending — no fill on bar N's close.
    expect(fills).toHaveLength(0);

    // Bar N+1 arrives with open=101. The fill should land at 101, NOT 100.
    const barNPlus1 = makeBar('SPY', 2_000, /* open */ 101, /* close */ 102);
    bus.publish({
      id: 'evt-bar',
      type: 'BAR_RECEIVED',
      ts: barNPlus1.ts,
      mode: 'backtest',
      payload: barNPlus1,
    });

    expect(fills).toHaveLength(1);
    expect(fills[0].fill.price).toBe(101);
    expect(fills[0].fill.ts).toBe(barNPlus1.ts);
    expect(sink.pendingCount('SPY')).toBe(0);
  });

  it('a signal generated on bar N close cannot fill earlier than bar N+1 open (end-to-end)', async () => {
    // Even if multiple bars arrive without an intervening submission, prior
    // queued orders fill at the NEXT bar's open — never the current bar's close.
    const bus = new EventBus();
    const symbolState = new SymbolStateManager();
    const sink = new SimulatedExecutionSink(bus, symbolState, 'backtest', 0, 0);

    const fillsByPrice: number[] = [];
    bus.on('ORDER_FILLED', (e) => { fillsByPrice.push((e as OrderFilledEvent).fill.price); });

    // Bar 1 close=100, then submit.
    symbolState.onBar(makeBar('SPY', 1_000, 99, 100));
    await sink.submitOrder(makeIntent({ id: 'i1' }));

    // Bar 2 open=110, close=120.
    bus.publish({
      id: 'e2', type: 'BAR_RECEIVED', ts: 2_000, mode: 'backtest',
      payload: makeBar('SPY', 2_000, 110, 120),
    });

    expect(fillsByPrice).toEqual([110]);
  });
});

describe('SimulatedExecutionSink: order accounting (fix #2)', () => {
  it('submitted order has filledQty=0 and empty fills; later fill is applied exactly once', async () => {
    const bus = new EventBus();
    const symbolState = new SymbolStateManager();
    const sink = new SimulatedExecutionSink(bus, symbolState, 'backtest', 0, 0);

    const submitted: Order[] = [];
    const fills: Fill[] = [];
    bus.on('ORDER_SUBMITTED', (e) => { submitted.push((e as OrderSubmittedEvent).payload); });
    bus.on('ORDER_FILLED', (e) => { fills.push((e as OrderFilledEvent).fill); });

    await sink.submitOrder(makeIntent({ qty: 7 }));
    expect(submitted).toHaveLength(1);
    expect(submitted[0].filledQty).toBe(0);
    expect(submitted[0].avgFillPrice).toBeUndefined();
    expect(submitted[0].fills).toHaveLength(0);
    expect(fills).toHaveLength(0);

    bus.publish({
      id: 'e', type: 'BAR_RECEIVED', ts: 2_000, mode: 'backtest',
      payload: makeBar('SPY', 2_000, 50, 55),
    });

    // Exactly one fill emitted, with full qty at the open price (slippage=0).
    expect(fills).toHaveLength(1);
    expect(fills[0].qty).toBe(7);
    expect(fills[0].price).toBe(50);
  });

  it('filledQty equals sum(fills.qty) and avgFillPrice is the weighted average after applyFill', () => {
    // Applies OrderStateManager directly: simulate two partial fills.
    const { OrderStateManager } = require('../../core/state/orderState');
    const oms = new OrderStateManager();
    const order: Order = {
      id: 'o', intentId: 'i', strategyId: 's', symbol: 'SPY',
      side: 'buy', qty: 10, filledQty: 0, orderType: 'market',
      timeInForce: 'ioc', status: 'submitted',
      submittedAt: 1_000, updatedAt: 1_000, fills: [],
    };
    oms.addOrder(order);

    const f1: Fill = {
      id: 'f1', orderId: 'o', symbol: 'SPY', side: 'buy', qty: 4, price: 100,
      notional: 400, commission: 0, ts: 2_000, isoTs: '',
    };
    const f2: Fill = {
      id: 'f2', orderId: 'o', symbol: 'SPY', side: 'buy', qty: 6, price: 110,
      notional: 660, commission: 0, ts: 3_000, isoTs: '',
    };

    oms.applyFill('o', f1);
    oms.applyFill('o', f2);

    const got = oms.getOrder('o')!;
    expect(got.filledQty).toBe(10);
    expect(got.filledQty).toBe(got.fills.reduce((s: number, f: Fill) => s + f.qty, 0));
    // Weighted avg: (4*100 + 6*110)/10 = 106
    expect(got.avgFillPrice).toBeCloseTo(106, 6);
    expect(got.status).toBe('filled');
  });
});

describe('SimulatedExecutionSink: zero/missing reference price rejection (fix #6)', () => {
  it('emits ORDER_REJECTED when no reference price is available', async () => {
    const bus = new EventBus();
    const symbolState = new SymbolStateManager();
    const sink = new SimulatedExecutionSink(bus, symbolState, 'backtest', 0, 0);

    const rejects: OrderRejectedEvent[] = [];
    const fills: OrderFilledEvent[] = [];
    bus.on('ORDER_REJECTED', (e) => { rejects.push(e as OrderRejectedEvent); });
    bus.on('ORDER_FILLED', (e) => { fills.push(e as OrderFilledEvent); });

    await sink.submitOrder(makeIntent({ id: 'no-price', limitPrice: undefined }));

    // Bar with open=0 — invalid reference price.
    bus.publish({
      id: 'e', type: 'BAR_RECEIVED', ts: 2_000, mode: 'backtest',
      payload: makeBar('SPY', 2_000, 0, 0),
    });

    expect(fills).toHaveLength(0);
    expect(rejects).toHaveLength(1);
    expect(rejects[0].orderId).toBe('no-price');
  });

  it('flushPending rejects when symbol state has no mid price', () => {
    const bus = new EventBus();
    const symbolState = new SymbolStateManager();
    const sink = new SimulatedExecutionSink(bus, symbolState, 'backtest', 0, 0);

    const rejects: OrderRejectedEvent[] = [];
    bus.on('ORDER_REJECTED', (e) => { rejects.push(e as OrderRejectedEvent); });

    void sink.submitOrder(makeIntent({ id: 'p' }));
    sink.flushPending('SPY');

    expect(rejects).toHaveLength(1);
    expect(rejects[0].reason).toMatch(/reference price/i);
  });
});
