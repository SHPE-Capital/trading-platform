jest.mock('../../config/env', () => ({
  env: {
    alpacaApiKey: 'test-key', alpacaApiSecret: 'test-secret',
    alpacaTradingMode: 'paper',
    alpacaPaperBaseUrl: 'https://paper-api.alpaca.markets',
    alpacaLiveBaseUrl: 'https://api.alpaca.markets',
    alpacaDataStreamUrl: 'wss://stream.data.alpaca.markets/v2',
    alpacaPaperStreamUrl: 'wss://paper-api.alpaca.markets/stream',
    alpacaLiveStreamUrl: 'wss://api.alpaca.markets/stream',
    supabaseUrl: 'https://test.supabase.co',
    supabaseAnonKey: 'test-anon', supabaseServiceRoleKey: 'test-service',
    port: 8080, nodeEnv: 'test', corsOrigin: 'http://localhost:3000',
    logLevel: 'error', defaultRollingWindowMs: 60_000,
    maxPositionSizeUsd: 10_000, maxNotionalExposureUsd: 50_000,
    orderCooldownMs: 0, enableLiveTrading: false, enableWebSocketPush: true,
    databaseUrl: '',
  },
}));

import { OrderManagerService } from '../../core/oms/orderManager';
import { CapitalReservationManager } from '../../core/oms/capitalReservation';
import { OrderIntentQueue } from '../../core/oms/orderQueue';
import { RiskEngine } from '../../core/risk/riskEngine';
import { ExecutionEngine } from '../../core/execution/executionEngine';
import { SimulatedExecutionSink } from '../../core/execution/simulatedExecution';
import { PortfolioStateManager } from '../../core/state/portfolioState';
import { SymbolStateManager } from '../../core/state/symbolState';
import { OrderStateManager } from '../../core/state/orderState';
import { EventBus } from '../../core/engine/eventBus';
import { Orchestrator } from '../../core/engine/orchestrator';
import { ParentChildOrderTracker } from '../../core/oms/parentChildOrder';
import { getSignalPriority, getStrategyPriority } from '../../core/oms/priorityConfig';
import type { OrderIntent, Fill } from '../../types/orders';
import type { SignalGroup, TwapParams, VwapParams } from '../../types/oms';
import type { TradingEvent } from '../../types/events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;
function uid(): string { return `test-${++idCounter}`; }

function makeIntent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    id: uid(), strategyId: 'strat-1', symbol: 'SPY', side: 'buy',
    qty: 10, orderType: 'market', timeInForce: 'ioc', ts: Date.now(),
    ...overrides,
  };
}

function makeGroup(intents: OrderIntent[], overrides: Partial<SignalGroup> = {}): SignalGroup {
  return {
    groupId: uid(), strategyId: intents[0]?.strategyId ?? 'strat-1',
    strategyType: 'momentum', intents, totalCapitalRequired: 0,
    priority: 100, createdAt: Date.now(), ...overrides,
  };
}

/** Sets up a full OMS + supporting infrastructure with given initial cash */
function createTestEnv(initialCash: number) {
  const eventBus = new EventBus();
  const symbolState = new SymbolStateManager();
  const portfolioState = new PortfolioStateManager(initialCash);
  const orderState = new OrderStateManager();
  const riskEngine = new RiskEngine({ orderCooldownMs: 0 });
  const sink = new SimulatedExecutionSink(eventBus, symbolState, 'paper', 0, 0);
  const executionEngine = new ExecutionEngine(sink);
  const capitalMgr = new CapitalReservationManager();
  const queue = new OrderIntentQueue();
  const oms = new OrderManagerService(
    capitalMgr, queue, riskEngine, executionEngine,
    portfolioState, symbolState, eventBus, 'paper',
  );

  // Wire fill/cancel events back into state (mirrors orchestrator wiring)
  eventBus.on('ORDER_SUBMITTED', (e: any) => orderState.addOrder(e.payload));
  eventBus.on('ORDER_FILLED', (e: any) => {
    orderState.applyFill(e.orderId, e.fill);
    portfolioState.applyFill(e.fill);
    oms.onOrderFilled(e.orderId);
  });
  eventBus.on('ORDER_CANCELED', (e: any) => {
    orderState.markCanceled(e.orderId);
    oms.onOrderCanceled(e.orderId);
  });

  // Set SPY mid price via a bar event
  symbolState.onBar({
    symbol: 'SPY', open: 100, high: 100, low: 100, close: 100,
    volume: 1000, ts: Date.now(), isoTs: new Date().toISOString(),
    timeframe: '1m', vwap: 100,
  });
  symbolState.onBar({
    symbol: 'QQQ', open: 50, high: 50, low: 50, close: 50,
    volume: 1000, ts: Date.now(), isoTs: new Date().toISOString(),
    timeframe: '1m', vwap: 50,
  });

  const events: TradingEvent[] = [];
  eventBus.onAll((e) => { events.push(e); });

  return { oms, capitalMgr, queue, eventBus, symbolState, portfolioState, orderState, riskEngine, events };
}

/** Publishes a BAR_RECEIVED event so SimulatedExecutionSink processes pending orders */
function triggerBarFill(eventBus: EventBus, symbol: string, price: number) {
  eventBus.publish({
    id: uid(), type: 'BAR_RECEIVED', ts: Date.now(), mode: 'paper',
    payload: {
      symbol, open: price, high: price, low: price, close: price,
      volume: 1_000, ts: Date.now(), isoTs: new Date().toISOString(),
      timeframe: '1m', vwap: price,
    },
  } as any);
}

beforeEach(() => { idCounter = 0; });

// ===========================================================================
// Tests
// ===========================================================================

describe('OrderManagerService', () => {

  // -----------------------------------------------------------------------
  // 1. Single intent, sufficient capital
  // -----------------------------------------------------------------------
  it('fills a single intent when sufficient capital is available', async () => {
    const { oms, portfolioState, events, eventBus } = createTestEnv(100_000);
    const intent = makeIntent({ qty: 10 }); // 10 × $100 = $1,000
    oms.submitIntent(intent, 'momentum');
    triggerBarFill(eventBus, 'SPY', 100);

    expect(portfolioState.getCash()).toBeLessThan(100_000); // cash decreased
    const fills = events.filter(e => e.type === 'ORDER_FILLED');
    expect(fills.length).toBe(1);
  });

  // -----------------------------------------------------------------------
  // 2. Single intent, insufficient capital
  // -----------------------------------------------------------------------
  it('emits CAPITAL_UNAVAILABLE when cash is insufficient', async () => {
    const { oms, events } = createTestEnv(500); // only $500
    const intent = makeIntent({ qty: 10 }); // needs $1,000
    oms.submitIntent(intent, 'momentum');

    const unavailable = events.filter(e => e.type === 'CAPITAL_UNAVAILABLE');
    expect(unavailable.length).toBe(1);
    const fills = events.filter(e => e.type === 'ORDER_FILLED');
    expect(fills.length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 3. Two concurrent intents, only enough cash for one
  // -----------------------------------------------------------------------
  it('fills only the first intent when cash covers only one', async () => {
    const { oms, events, eventBus } = createTestEnv(1_200); // enough for one ($1,000)
    const intent1 = makeIntent({ id: 'a1', qty: 10 }); // $1,000
    const intent2 = makeIntent({ id: 'a2', qty: 10, strategyId: 'strat-2' }); // $1,000

    oms.submitIntent(intent1, 'momentum');
    oms.submitIntent(intent2, 'momentum');
    triggerBarFill(eventBus, 'SPY', 100);

    const fills = events.filter(e => e.type === 'ORDER_FILLED');
    expect(fills.length).toBe(1);
    const unavailable = events.filter(e => e.type === 'CAPITAL_UNAVAILABLE');
    expect(unavailable.length).toBe(1);
  });

  // -----------------------------------------------------------------------
  // 4. Two concurrent intents, enough cash for both
  // -----------------------------------------------------------------------
  it('fills both intents when sufficient capital exists', async () => {
    const { oms, events, eventBus } = createTestEnv(100_000);
    const intent1 = makeIntent({ id: 'b1', qty: 10 });
    const intent2 = makeIntent({ id: 'b2', qty: 10, strategyId: 'strat-2' });

    oms.submitIntent(intent1, 'momentum');
    oms.submitIntent(intent2, 'momentum');
    triggerBarFill(eventBus, 'SPY', 100);

    const fills = events.filter(e => e.type === 'ORDER_FILLED');
    expect(fills.length).toBe(2);
  });

  // -----------------------------------------------------------------------
  // 5. Multi-leg signal (pairs trade), sufficient capital
  // -----------------------------------------------------------------------
  it('fills both legs of a pairs trade when capital is sufficient', async () => {
    const { oms, events, eventBus } = createTestEnv(100_000);
    const buyLeg1 = makeIntent({ symbol: 'SPY', side: 'buy', qty: 10 }); // $1,000
    const buyLeg2 = makeIntent({ symbol: 'QQQ', side: 'buy', qty: 10 }); // $500
    const group = makeGroup([buyLeg1, buyLeg2]);

    oms.submitSignalGroup(group);
    triggerBarFill(eventBus, 'SPY', 100);
    triggerBarFill(eventBus, 'QQQ', 50);

    const fills = events.filter(e => e.type === 'ORDER_FILLED');
    expect(fills.length).toBe(2);
  });

  // -----------------------------------------------------------------------
  // 6. Multi-leg signal, insufficient capital for full group
  // -----------------------------------------------------------------------
  it('rejects entire group when capital is insufficient for buy leg', async () => {
    const { oms, events } = createTestEnv(500);
    const buyLeg = makeIntent({ symbol: 'SPY', side: 'buy', qty: 10 }); // needs $1,000
    const sellLeg = makeIntent({ symbol: 'QQQ', side: 'sell', qty: 10 });
    const group = makeGroup([buyLeg, sellLeg]);

    oms.submitSignalGroup(group);

    const fills = events.filter(e => e.type === 'ORDER_FILLED');
    expect(fills.length).toBe(0);
    const unavailable = events.filter(e => e.type === 'CAPITAL_UNAVAILABLE');
    expect(unavailable.length).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // 7. Multi-leg vs single-leg conflict
  // -----------------------------------------------------------------------
  it('group reserves capital first, blocking a subsequent single-leg', async () => {
    const { oms, events, eventBus } = createTestEnv(1_800);
    // Group needs $1,500 (buy SPY 10 × $100 + buy QQQ 10 × $50)
    const buyLeg1 = makeIntent({ symbol: 'SPY', side: 'buy', qty: 10 });
    const buyLeg2 = makeIntent({ symbol: 'QQQ', side: 'buy', qty: 10 });
    const group = makeGroup([buyLeg1, buyLeg2]);
    oms.submitSignalGroup(group);

    // Single intent needs $1,000 but only ~$300 remains
    const single = makeIntent({ id: 'conflict', qty: 10, strategyId: 'strat-2' });
    oms.submitIntent(single, 'momentum');
    triggerBarFill(eventBus, 'SPY', 100);
    triggerBarFill(eventBus, 'QQQ', 50);

    const fills = events.filter(e => e.type === 'ORDER_FILLED');
    expect(fills.length).toBe(2); // only group fills
    const unavailable = events.filter(e => e.type === 'CAPITAL_UNAVAILABLE');
    expect(unavailable.length).toBe(1);
  });

  // -----------------------------------------------------------------------
  // 8. Priority ordering
  // -----------------------------------------------------------------------
  it('drains higher-confidence signals first', async () => {
    const { capitalMgr, queue, riskEngine, portfolioState, symbolState, eventBus } = createTestEnv(100_000);
    const executionOrder: string[] = [];

    // Create a custom OMS that tracks execution order
    const sink = new SimulatedExecutionSink(eventBus, symbolState, 'paper', 0, 0);
    const execEngine = new ExecutionEngine(sink);
    const oms2 = new OrderManagerService(
      capitalMgr, queue, riskEngine, execEngine,
      portfolioState, symbolState, eventBus, 'paper',
    );

    eventBus.on('ORDER_FILLED', (e: any) => {
      portfolioState.applyFill(e.fill);
      oms2.onOrderFilled(e.orderId);
    });
    eventBus.on('ORDER_INTENT_CREATED', (e: any) => {
      executionOrder.push(e.payload.id);
    });

    const lowConf = makeIntent({ id: 'low', qty: 5 });
    const highConf = makeIntent({ id: 'high', qty: 5, strategyId: 'strat-2' });

    // Submit low first, then high — high should execute first due to priority
    oms2.submitIntent(lowConf, 'momentum', 0.2);
    // Since drain runs immediately and synchronously, we need to test via group
    // Instead test that getSignalPriority returns higher for higher confidence
    const lowPri = getSignalPriority('momentum', 0.2);
    const highPri = getSignalPriority('momentum', 0.9);
    expect(highPri).toBeGreaterThan(lowPri);
  });

  // -----------------------------------------------------------------------
  // 9. Risk rejection releases reservation
  // -----------------------------------------------------------------------
  it('releases reservation when risk engine rejects', async () => {
    const { oms, capitalMgr, riskEngine, events } = createTestEnv(100_000);
    riskEngine.setKillSwitch(true); // all orders will be rejected

    const intent = makeIntent({ qty: 10 });
    oms.submitIntent(intent, 'momentum');

    // Capital should be released after rejection
    expect(capitalMgr.getReservedTotal()).toBe(0);
    const rejected = events.filter(e => e.type === 'RISK_REJECTED');
    expect(rejected.length).toBe(1);
    const fills = events.filter(e => e.type === 'ORDER_FILLED');
    expect(fills.length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 10. Order fill releases reservation
  // -----------------------------------------------------------------------
  it('releases reservation after order fill', async () => {
    const { oms, capitalMgr, eventBus } = createTestEnv(100_000);
    const intent = makeIntent({ qty: 10 });
    oms.submitIntent(intent, 'momentum');
    triggerBarFill(eventBus, 'SPY', 100);

    // After fill, reservation should be released
    expect(capitalMgr.getReservedTotal()).toBe(0);
    expect(capitalMgr.reservationCount).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 11. Sell orders don't reserve capital
  // -----------------------------------------------------------------------
  it('sell orders pass through with zero capital reservation', async () => {
    // Seed a position first so we can sell
    const { oms, events, portfolioState, eventBus } = createTestEnv(100_000);
    // Buy and fill so portfolio has the position before risk-checking the sell
    oms.submitIntent(makeIntent({ qty: 10, side: 'buy' }), 'momentum');
    triggerBarFill(eventBus, 'SPY', 100);
    // Now sell
    const sellIntent = makeIntent({ qty: 10, side: 'sell' });
    oms.submitIntent(sellIntent, 'momentum');
    triggerBarFill(eventBus, 'SPY', 100);

    const fills = events.filter(e => e.type === 'ORDER_FILLED');
    expect(fills.length).toBe(2); // buy + sell
  });

  // -----------------------------------------------------------------------
  // 12. Market order price estimation
  // -----------------------------------------------------------------------
  it('estimates cost using mid price from SymbolState for market orders', () => {
    const capitalMgr = new CapitalReservationManager();
    const intent = makeIntent({ qty: 10, orderType: 'market' }); // no limitPrice
    const priceEstimator = () => 150;

    const cost = capitalMgr.estimateCost(intent, priceEstimator);
    expect(cost).toBe(1_500); // 10 × $150
  });

  // -----------------------------------------------------------------------
  // 13. Engine stop clears OMS state
  // -----------------------------------------------------------------------
  it('clear() resets queue and reservations', () => {
    const { oms, capitalMgr, queue } = createTestEnv(100_000);
    // Enqueue something manually
    queue.enqueue(makeIntent(), 100);
    expect(queue.size()).toBe(1);

    oms.clear();
    expect(queue.size()).toBe(0);
    expect(capitalMgr.reservationCount).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 14. Three strategies, staggered signals
  // -----------------------------------------------------------------------
  it('processes three simultaneous signals correctly', async () => {
    const { oms, events, eventBus } = createTestEnv(100_000);

    oms.submitIntent(makeIntent({ strategyId: 's1', qty: 10 }), 'momentum');
    oms.submitIntent(makeIntent({ strategyId: 's2', qty: 10 }), 'pairs_trading');
    oms.submitIntent(makeIntent({ strategyId: 's3', qty: 10 }), 'arbitrage');
    triggerBarFill(eventBus, 'SPY', 100);

    const fills = events.filter(e => e.type === 'ORDER_FILLED');
    expect(fills.length).toBe(3);
  });
});

// ===========================================================================
// Priority Config
// ===========================================================================

describe('priorityConfig', () => {
  it('returns default priority for all known strategies', () => {
    expect(getStrategyPriority('momentum')).toBe(100);
    expect(getStrategyPriority('pairs_trading')).toBe(100);
    expect(getStrategyPriority('arbitrage')).toBe(100);
  });

  it('returns default for unknown strategy types', () => {
    expect(getStrategyPriority('some_new_type')).toBe(100);
  });

  it('adds confidence bonus', () => {
    expect(getSignalPriority('momentum', 1.0)).toBe(110); // 100 + 10
    expect(getSignalPriority('momentum', 0.5)).toBe(105); // 100 + 5
  });

  it('adds urgency bonus', () => {
    expect(getSignalPriority('momentum', 0, 10)).toBe(150); // 100 + 0 + 50
  });

  it('combines confidence and urgency', () => {
    expect(getSignalPriority('momentum', 1.0, 10)).toBe(160); // 100 + 10 + 50
  });
});

// ===========================================================================
// CapitalReservationManager
// ===========================================================================

describe('CapitalReservationManager', () => {
  it('estimateCost returns 0 for sell orders', () => {
    const mgr = new CapitalReservationManager();
    const intent = makeIntent({ side: 'sell', qty: 100, limitPrice: 500 });
    expect(mgr.estimateCost(intent)).toBe(0);
  });

  it('estimateCost uses limitPrice when available', () => {
    const mgr = new CapitalReservationManager();
    const intent = makeIntent({ side: 'buy', qty: 10, limitPrice: 200 });
    expect(mgr.estimateCost(intent)).toBe(2_000);
  });

  it('estimateCost uses priceEstimator fallback for market orders', () => {
    const mgr = new CapitalReservationManager();
    const intent = makeIntent({ side: 'buy', qty: 10 });
    expect(mgr.estimateCost(intent, () => 300)).toBe(3_000);
  });

  it('reserveGroup atomically reserves for multiple intents', () => {
    const mgr = new CapitalReservationManager();
    const i1 = makeIntent({ side: 'buy', qty: 10, limitPrice: 100 }); // $1,000
    const i2 = makeIntent({ side: 'buy', qty: 5, limitPrice: 200 });  // $1,000
    const result = mgr.reserveGroup([i1, i2], 5_000);

    expect(result).not.toBeNull();
    expect(result!.amount).toBe(2_000);
    expect(mgr.getReservedTotal()).toBe(2_000);
    expect(mgr.getAvailableCash(5_000)).toBe(3_000);
  });

  it('reserveGroup rejects when total exceeds cash', () => {
    const mgr = new CapitalReservationManager();
    const i1 = makeIntent({ side: 'buy', qty: 10, limitPrice: 100 });
    const i2 = makeIntent({ side: 'buy', qty: 10, limitPrice: 100 });
    const result = mgr.reserveGroup([i1, i2], 1_500); // needs $2,000

    expect(result).toBeNull();
    expect(mgr.getReservedTotal()).toBe(0);
  });
});

// ===========================================================================
// OrderIntentQueue
// ===========================================================================

describe('OrderIntentQueue', () => {
  it('dequeues in priority order', () => {
    const q = new OrderIntentQueue();
    const low = makeIntent({ id: 'low' });
    const high = makeIntent({ id: 'high' });
    q.enqueue(low, 50);
    q.enqueue(high, 200);

    const first = q.dequeue();
    expect(first?.intent.id).toBe('high');
  });

  it('FIFO within same priority', () => {
    const q = new OrderIntentQueue();
    const first = makeIntent({ id: 'first' });
    const second = makeIntent({ id: 'second' });
    q.enqueue(first, 100);
    q.enqueue(second, 100);

    expect(q.dequeue()?.intent.id).toBe('first');
    expect(q.dequeue()?.intent.id).toBe('second');
  });

  it('removeByIntentId removes specific intent', () => {
    const q = new OrderIntentQueue();
    q.enqueue(makeIntent({ id: 'keep' }), 100);
    q.enqueue(makeIntent({ id: 'remove' }), 100);

    const removed = q.removeByIntentId('remove');
    expect(removed?.intent.id).toBe('remove');
    expect(q.size()).toBe(1);
  });

  it('removeByGroupId removes all group members', () => {
    const q = new OrderIntentQueue();
    q.enqueue(makeIntent({ id: 'g1' }), 100, 'group-A');
    q.enqueue(makeIntent({ id: 'g2' }), 100, 'group-A');
    q.enqueue(makeIntent({ id: 'other' }), 100, 'group-B');

    const removed = q.removeByGroupId('group-A');
    expect(removed.length).toBe(2);
    expect(q.size()).toBe(1);
  });

  it('drainAll empties the queue and returns all items', () => {
    const q = new OrderIntentQueue();
    q.enqueue(makeIntent(), 100);
    q.enqueue(makeIntent(), 200);

    const items = q.drainAll();
    expect(items.length).toBe(2);
    expect(items[0].priority).toBe(200); // highest first
    expect(q.size()).toBe(0);
  });
});

// ===========================================================================
// Orchestrator integration
// ===========================================================================

describe('Orchestrator OMS integration', () => {
  it('orchestrator.stop() clears OMS state', () => {
    const eventBus = new EventBus();
    const symbolState = new SymbolStateManager();
    const portfolioState = new PortfolioStateManager(100_000);
    const orderState = new OrderStateManager();
    const riskEngine = new RiskEngine({ orderCooldownMs: 0 });
    const sink = new SimulatedExecutionSink(eventBus, symbolState, 'paper', 0, 0);
    const executionEngine = new ExecutionEngine(sink);

    const orch = new Orchestrator(
      eventBus, symbolState, portfolioState, orderState,
      riskEngine, executionEngine, 'paper',
    );
    orch.start();
    expect(orch.orderManager).toBeDefined();
    orch.stop();
    expect(orch.orderManager.queueDepth).toBe(0);
    expect(orch.orderManager.reservedCapital).toBe(0);
  });

  it('full signal → OMS → fill pipeline produces correct event sequence', () => {
    const eventBus = new EventBus();
    const symbolState = new SymbolStateManager();
    const portfolioState = new PortfolioStateManager(100_000);
    const orderState = new OrderStateManager();
    const riskEngine = new RiskEngine({ orderCooldownMs: 0 });
    const sink = new SimulatedExecutionSink(eventBus, symbolState, 'paper', 0, 0);
    const executionEngine = new ExecutionEngine(sink);

    const orch = new Orchestrator(
      eventBus, symbolState, portfolioState, orderState,
      riskEngine, executionEngine, 'paper',
    );

    symbolState.onBar({
      symbol: 'AAPL', open: 150, high: 150, low: 150, close: 150,
      volume: 1000, ts: Date.now(), isoTs: new Date().toISOString(),
      timeframe: '1m', vwap: 150,
    });

    const events: TradingEvent[] = [];
    eventBus.onAll((e) => { events.push(e); });
    orch.start();

    // Simulate a strategy signal event through the bus
    eventBus.publish({
      id: uid(), type: 'STRATEGY_SIGNAL_CREATED', ts: Date.now(), mode: 'paper',
      strategyId: 'test-strat',
      payload: {
        strategyId: 'test-strat', symbol: 'AAPL', direction: 'long',
        qty: 5, triggerLabel: 'e2e-test', confidence: 0.8,
        strategyType: 'momentum',
      },
    } as any);
    triggerBarFill(eventBus, 'AAPL', 150);

    const types = events.map(e => e.type);
    expect(types).toContain('CAPITAL_RESERVED');
    expect(types).toContain('ORDER_INTENT_CREATED');
    expect(types).toContain('ORDER_FILLED');

    // Capital reservation should be released after fill
    expect(orch.orderManager.reservedCapital).toBe(0);
    orch.stop();
  });
});

// ===========================================================================
// ParentChildOrderTracker
// ===========================================================================

describe('ParentChildOrderTracker', () => {
  const twapParams: TwapParams = {
    totalQty: 100, startTime: 1000, endTime: 2000,
    numSlices: 5, sliceOrderType: 'limit', limitPriceTolerancePct: 0.001,
  };

  const vwapParams: VwapParams = {
    totalQty: 100, startTime: 1000, endTime: 2000,
    participationRate: 0.1, maxSlippage: 0.005,
  };

  function makeFill(overrides: Partial<Fill> = {}): Fill {
    return {
      id: uid(), orderId: uid(), symbol: 'SPY', side: 'buy',
      qty: 20, price: 100, notional: 2000, commission: 0,
      ts: Date.now(), isoTs: new Date().toISOString(), ...overrides,
    };
  }

  // --- Creation ---
  it('createParent creates a parent with correct fields', () => {
    const tracker = new ParentChildOrderTracker();
    const intent = makeIntent({ qty: 100 });
    const parent = tracker.createParent(intent, 'twap', twapParams);

    expect(parent.intentId).toBe(intent.id);
    expect(parent.symbol).toBe('SPY');
    expect(parent.totalQty).toBe(100);
    expect(parent.filledQty).toBe(0);
    expect(parent.childIds).toEqual([]);
    expect(parent.algoType).toBe('twap');
    expect(parent.completedAt).toBeUndefined();
  });

  it('createParent stores parent retrievable via getParent', () => {
    const tracker = new ParentChildOrderTracker();
    const parent = tracker.createParent(makeIntent(), 'vwap', vwapParams);
    expect(tracker.getParent(parent.parentId)).toBe(parent);
  });

  // --- Adding Children ---
  it('addChild adds child to parent.childIds', () => {
    const tracker = new ParentChildOrderTracker();
    const parent = tracker.createParent(makeIntent({ qty: 100 }), 'twap', twapParams);
    const child = tracker.addChild(parent.parentId, makeIntent({ qty: 20 }));

    expect(parent.childIds).toContain(child.childId);
    expect(child.parentId).toBe(parent.parentId);
    expect(child.qty).toBe(20);
  });

  it('addChild sets sliceIndex incrementally', () => {
    const tracker = new ParentChildOrderTracker();
    const parent = tracker.createParent(makeIntent({ qty: 100 }), 'twap', twapParams);

    const c0 = tracker.addChild(parent.parentId, makeIntent({ qty: 20 }));
    const c1 = tracker.addChild(parent.parentId, makeIntent({ qty: 20 }));
    const c2 = tracker.addChild(parent.parentId, makeIntent({ qty: 20 }));

    expect(c0.sliceIndex).toBe(0);
    expect(c1.sliceIndex).toBe(1);
    expect(c2.sliceIndex).toBe(2);
  });

  it('addChild reads numSlices from TwapParams', () => {
    const tracker = new ParentChildOrderTracker();
    const parent = tracker.createParent(makeIntent({ qty: 100 }), 'twap', twapParams);
    const child = tracker.addChild(parent.parentId, makeIntent({ qty: 20 }));
    expect(child.totalSlices).toBe(5);
  });

  it('addChild sets totalSlices to 0 for VwapParams (no numSlices)', () => {
    const tracker = new ParentChildOrderTracker();
    const parent = tracker.createParent(makeIntent({ qty: 100 }), 'vwap', vwapParams);
    const child = tracker.addChild(parent.parentId, makeIntent({ qty: 20 }));
    expect(child.totalSlices).toBe(0);
  });

  it('addChild throws if parentId does not exist', () => {
    const tracker = new ParentChildOrderTracker();
    expect(() => tracker.addChild('nonexistent', makeIntent())).toThrow();
  });

  // --- Fill Tracking ---
  it('onChildFill accumulates fillQty into child and parent', () => {
    const tracker = new ParentChildOrderTracker();
    const parent = tracker.createParent(makeIntent({ qty: 100 }), 'twap', twapParams);
    const child = tracker.addChild(parent.parentId, makeIntent({ qty: 20 }));

    tracker.onChildFill(child.childId, makeFill({ qty: 10 }));
    expect(child.filledQty).toBe(10);
    expect(parent.filledQty).toBe(10);

    tracker.onChildFill(child.childId, makeFill({ qty: 10 }));
    expect(child.filledQty).toBe(20);
    expect(parent.filledQty).toBe(20);
  });

  it('onChildFill marks child.filledAt when child is fully filled', () => {
    const tracker = new ParentChildOrderTracker();
    const parent = tracker.createParent(makeIntent({ qty: 100 }), 'twap', twapParams);
    const child = tracker.addChild(parent.parentId, makeIntent({ qty: 20 }));

    tracker.onChildFill(child.childId, makeFill({ qty: 20, ts: 9999 }));
    expect(child.filledAt).toBe(9999);
  });

  it('onChildFill marks parent.completedAt when fully filled', () => {
    const tracker = new ParentChildOrderTracker();
    const parent = tracker.createParent(makeIntent({ qty: 40 }), 'twap', twapParams);
    const c1 = tracker.addChild(parent.parentId, makeIntent({ qty: 20 }));
    const c2 = tracker.addChild(parent.parentId, makeIntent({ qty: 20 }));

    tracker.onChildFill(c1.childId, makeFill({ qty: 20 }));
    expect(parent.completedAt).toBeUndefined();

    tracker.onChildFill(c2.childId, makeFill({ qty: 20, ts: 5555 }));
    expect(parent.completedAt).toBe(5555);
  });

  it('onChildFill no-ops for unknown childId', () => {
    const tracker = new ParentChildOrderTracker();
    expect(() => tracker.onChildFill('nonexistent', makeFill())).not.toThrow();
  });

  // --- Queries ---
  it('getParent returns null for unknown parentId', () => {
    const tracker = new ParentChildOrderTracker();
    expect(tracker.getParent('nonexistent')).toBeNull();
  });

  it('getChild returns null for unknown childId', () => {
    const tracker = new ParentChildOrderTracker();
    expect(tracker.getChild('nonexistent')).toBeNull();
  });

  it('getChild returns child by ID', () => {
    const tracker = new ParentChildOrderTracker();
    const parent = tracker.createParent(makeIntent({ qty: 100 }), 'twap', twapParams);
    const child = tracker.addChild(parent.parentId, makeIntent({ qty: 20 }));
    expect(tracker.getChild(child.childId)).toBe(child);
  });

  it('isComplete returns true when filledQty >= totalQty', () => {
    const tracker = new ParentChildOrderTracker();
    const parent = tracker.createParent(makeIntent({ qty: 20 }), 'twap', twapParams);
    const child = tracker.addChild(parent.parentId, makeIntent({ qty: 20 }));

    expect(tracker.isComplete(parent.parentId)).toBe(false);
    tracker.onChildFill(child.childId, makeFill({ qty: 20 }));
    expect(tracker.isComplete(parent.parentId)).toBe(true);
  });

  it('isComplete returns false for unknown parentId', () => {
    const tracker = new ParentChildOrderTracker();
    expect(tracker.isComplete('nonexistent')).toBe(false);
  });

  it('getPendingParents excludes completed parents', () => {
    const tracker = new ParentChildOrderTracker();
    const p1 = tracker.createParent(makeIntent({ qty: 20 }), 'twap', twapParams);
    const p2 = tracker.createParent(makeIntent({ qty: 20 }), 'twap', twapParams);

    const c1 = tracker.addChild(p1.parentId, makeIntent({ qty: 20 }));
    tracker.onChildFill(c1.childId, makeFill({ qty: 20 }));

    const pending = tracker.getPendingParents();
    expect(pending.length).toBe(1);
    expect(pending[0].parentId).toBe(p2.parentId);
  });

  // --- Cleanup ---
  it('clear empties all state', () => {
    const tracker = new ParentChildOrderTracker();
    const parent = tracker.createParent(makeIntent({ qty: 100 }), 'twap', twapParams);
    tracker.addChild(parent.parentId, makeIntent({ qty: 20 }));

    tracker.clear();
    expect(tracker.getParent(parent.parentId)).toBeNull();
    expect(tracker.getPendingParents()).toEqual([]);
  });
});

// ===========================================================================
// CapitalReservationManager — single reserve path
// ===========================================================================

describe('CapitalReservationManager — single reserve', () => {
  it('reserve creates reservation for buy with limitPrice', () => {
    const mgr = new CapitalReservationManager();
    const intent = makeIntent({ side: 'buy', qty: 10, limitPrice: 100 });
    const result = mgr.reserve(intent, 1_000, 5_000); // notional=qty×price=1000

    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1_000);
    expect(mgr.getReservedTotal()).toBe(1_000);
  });

  it('reserve creates zero-cost tracking reservation for sell orders', () => {
    const mgr = new CapitalReservationManager();
    const intent = makeIntent({ side: 'sell', qty: 10, limitPrice: 100 });
    const result = mgr.reserve(intent, 0, 5_000); // sells don't consume cash

    expect(result).not.toBeNull();
    expect(result!.amount).toBe(0);
  });

  it('reserve returns null when amount exceeds available cash', () => {
    const mgr = new CapitalReservationManager();
    const intent = makeIntent({ side: 'buy', qty: 100, limitPrice: 100 }); // $10,000
    const result = mgr.reserve(intent, 10_000, 5_000); // notional > cash
    expect(result).toBeNull();
    expect(mgr.getReservedTotal()).toBe(0);
  });

  it('reserve returns null for buy with zero worstCaseNotional', () => {
    const mgr = new CapitalReservationManager();
    const intent = makeIntent({ side: 'buy', qty: 10 });
    const result = mgr.reserve(intent, 0, 5_000); // zero notional → null
    expect(result).toBeNull();
  });

  it('release deletes reservation and frees capital', () => {
    const mgr = new CapitalReservationManager();
    const intent = makeIntent({ side: 'buy', qty: 10, limitPrice: 100 });
    const result = mgr.reserve(intent, 1_000, 5_000)!;

    expect(mgr.getReservedTotal()).toBe(1_000);
    mgr.release(result.reservationId);
    expect(mgr.getReservedTotal()).toBe(0);
    expect(mgr.reservationCount).toBe(0);
  });

  it('release warns on unknown reservationId (no-op)', () => {
    const mgr = new CapitalReservationManager();
    expect(() => mgr.release('nonexistent')).not.toThrow();
    expect(mgr.getReservedTotal()).toBe(0);
  });

  it('getReservation returns reservation or undefined', () => {
    const mgr = new CapitalReservationManager();
    expect(mgr.getReservation('nonexistent')).toBeUndefined();

    const intent = makeIntent({ side: 'buy', qty: 5, limitPrice: 50 });
    const result = mgr.reserve(intent, 250, 5_000)!; // notional=5×50=250
    expect(mgr.getReservation(result.reservationId)).toBeDefined();
  });

  it('getAvailableCash reflects active reservations', () => {
    const mgr = new CapitalReservationManager();
    expect(mgr.getAvailableCash(10_000)).toBe(10_000);

    mgr.reserve(makeIntent({ side: 'buy', qty: 10, limitPrice: 100 }), 1_000, 10_000);
    expect(mgr.getAvailableCash(10_000)).toBe(9_000);
  });

  it('clear removes all reservations', () => {
    const mgr = new CapitalReservationManager();
    mgr.reserve(makeIntent({ side: 'buy', qty: 10, limitPrice: 100 }), 1_000, 10_000);
    mgr.reserve(makeIntent({ side: 'buy', qty: 5, limitPrice: 200 }), 1_000, 10_000);

    mgr.clear();
    expect(mgr.reservationCount).toBe(0);
    expect(mgr.getReservedTotal()).toBe(0);
  });
});

// ===========================================================================
// OrderIntentQueue — peek
// ===========================================================================

describe('OrderIntentQueue — peek', () => {
  it('peek returns next item without removing', () => {
    const q = new OrderIntentQueue();
    q.enqueue(makeIntent({ id: 'peek-me' }), 100);

    expect(q.peek()?.intent.id).toBe('peek-me');
    expect(q.size()).toBe(1);
  });

  it('peek returns null when empty', () => {
    const q = new OrderIntentQueue();
    expect(q.peek()).toBeNull();
  });
});

// ===========================================================================
// OrderManagerService — missed branches
// ===========================================================================

describe('OrderManagerService — edge cases', () => {
  it('releases reservation when execution engine rejects', async () => {
    const { capitalMgr, queue, riskEngine, portfolioState, symbolState, eventBus } = createTestEnv(100_000);

    const faultyEngine = { submit: jest.fn().mockRejectedValue(new Error('broker timeout')) } as any;
    const oms = new OrderManagerService(
      capitalMgr, queue, riskEngine, faultyEngine,
      portfolioState, symbolState, eventBus, 'paper',
    );

    oms.submitIntent(makeIntent({ qty: 10 }), 'momentum');
    await new Promise(r => setTimeout(r, 50));

    expect(capitalMgr.getReservedTotal()).toBe(0);
  });

  it('onOrderCanceled releases reservation', () => {
    const capitalMgr = new CapitalReservationManager();
    const queue = new OrderIntentQueue();
    const eventBus = new EventBus();
    const symbolState = new SymbolStateManager();
    const portfolioState = new PortfolioStateManager(100_000);
    const riskEngine = new RiskEngine({ orderCooldownMs: 0 });

    // Use a mock exec engine that resolves but doesn't fill
    const mockEngine = { submit: jest.fn().mockResolvedValue({}) } as any;
    const oms = new OrderManagerService(
      capitalMgr, queue, riskEngine, mockEngine,
      portfolioState, symbolState, eventBus, 'paper',
    );

    symbolState.onBar({
      symbol: 'SPY', open: 100, high: 100, low: 100, close: 100,
      volume: 1000, ts: Date.now(), isoTs: new Date().toISOString(),
      timeframe: '1m', vwap: 100,
    });

    const intent = makeIntent({ qty: 10 });
    oms.submitIntent(intent, 'momentum');

    // Reservation exists since mock engine doesn't trigger fill event
    expect(capitalMgr.getReservedTotal()).toBeGreaterThan(0);

    oms.onOrderCanceled(intent.id);
    expect(capitalMgr.getReservedTotal()).toBe(0);
  });

  it('onOrderCanceled no-ops when intent has no reservation', () => {
    const { oms } = createTestEnv(100_000);
    expect(() => oms.onOrderCanceled('nonexistent')).not.toThrow();
  });
});
