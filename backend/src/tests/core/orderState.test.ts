jest.mock('../../utils/time');

import * as time from '../../utils/time';
import { OrderStateManager } from '../../core/state/orderState';
import type { Order, Fill } from '../../types/orders';

const mockNowMs = time.nowMs as jest.Mock;

beforeEach(() => {
  mockNowMs.mockReturnValue(1_000);
  jest.clearAllMocks();
  mockNowMs.mockReturnValue(1_000);
});

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    brokerOrderId: undefined,
    intentId: 'intent-1',
    strategyId: 'strat-1',
    symbol: 'SPY',
    side: 'buy',
    qty: 10,
    filledQty: 0,
    orderType: 'market',
    timeInForce: 'day',
    status: 'submitted',
    submittedAt: 1_000,
    updatedAt: 1_000,
    fills: [],
    ...overrides,
  };
}

function makeFill(overrides: Partial<Fill> = {}): Fill {
  return {
    id: 'fill-1',
    orderId: 'order-1',
    symbol: 'SPY',
    side: 'buy',
    qty: 5,
    price: 500,
    notional: 2_500,
    commission: 0,
    ts: 2_000,
    isoTs: new Date(2_000).toISOString(),
    ...overrides,
  };
}

describe('addOrder / getOrder / getAllOrders', () => {
  it('addOrder stores the order; getOrder retrieves it by id', () => {
    const mgr = new OrderStateManager();
    const order = makeOrder();
    mgr.addOrder(order);
    expect(mgr.getOrder('order-1')).toEqual(order);
  });

  it('getOrder returns null for an unknown id', () => {
    expect(new OrderStateManager().getOrder('missing')).toBeNull();
  });

  it('getAllOrders returns all tracked orders', () => {
    const mgr = new OrderStateManager();
    mgr.addOrder(makeOrder({ id: 'o1' }));
    mgr.addOrder(makeOrder({ id: 'o2' }));
    expect(mgr.getAllOrders()).toHaveLength(2);
  });
});

describe('getOpenOrders', () => {
  it('returns only submitted, acknowledged, and partial_fill orders', () => {
    const mgr = new OrderStateManager();
    mgr.addOrder(makeOrder({ id: 'o-submitted', status: 'submitted' }));
    mgr.addOrder(makeOrder({ id: 'o-ack', status: 'acknowledged' }));
    mgr.addOrder(makeOrder({ id: 'o-partial', status: 'partial_fill' }));
    mgr.addOrder(makeOrder({ id: 'o-filled', status: 'filled' }));
    mgr.addOrder(makeOrder({ id: 'o-canceled', status: 'canceled' }));
    const open = mgr.getOpenOrders();
    expect(open).toHaveLength(3);
    expect(open.map((o) => o.id)).toEqual(
      expect.arrayContaining(['o-submitted', 'o-ack', 'o-partial']),
    );
  });
});

describe('getOpenOrdersByStrategy', () => {
  it('filters open orders by strategyId', () => {
    const mgr = new OrderStateManager();
    mgr.addOrder(makeOrder({ id: 'o1', strategyId: 'strat-A' }));
    mgr.addOrder(makeOrder({ id: 'o2', strategyId: 'strat-B' }));
    expect(mgr.getOpenOrdersByStrategy('strat-A')).toHaveLength(1);
    expect(mgr.getOpenOrdersByStrategy('strat-A')[0].id).toBe('o1');
  });
});

describe('markAcknowledged', () => {
  it('sets brokerOrderId and changes status to acknowledged', () => {
    const mgr = new OrderStateManager();
    mgr.addOrder(makeOrder());
    mgr.markAcknowledged('order-1', 'broker-abc');
    const order = mgr.getOrder('order-1')!;
    expect(order.brokerOrderId).toBe('broker-abc');
    expect(order.status).toBe('acknowledged');
  });

  it('does nothing for an unknown order id', () => {
    expect(() => new OrderStateManager().markAcknowledged('missing', 'x')).not.toThrow();
  });
});

describe('applyFill', () => {
  it('adds fill and increments filledQty', () => {
    const mgr = new OrderStateManager();
    mgr.addOrder(makeOrder({ qty: 10 }));
    mgr.applyFill('order-1', makeFill({ qty: 5 }));
    const order = mgr.getOrder('order-1')!;
    expect(order.filledQty).toBe(5);
    expect(order.fills).toHaveLength(1);
  });

  it('sets status to partial_fill when filledQty < qty', () => {
    const mgr = new OrderStateManager();
    mgr.addOrder(makeOrder({ qty: 10 }));
    mgr.applyFill('order-1', makeFill({ qty: 5 }));
    expect(mgr.getOrder('order-1')!.status).toBe('partial_fill');
  });

  it('sets status to filled and closedAt when filledQty >= qty', () => {
    const mgr = new OrderStateManager();
    mgr.addOrder(makeOrder({ qty: 10 }));
    mgr.applyFill('order-1', makeFill({ qty: 10, ts: 5_000 }));
    const order = mgr.getOrder('order-1')!;
    expect(order.status).toBe('filled');
    expect(order.closedAt).toBe(5_000);
  });

  it('computes weighted average fill price across multiple fills', () => {
    const mgr = new OrderStateManager();
    mgr.addOrder(makeOrder({ qty: 20 }));
    mgr.applyFill('order-1', makeFill({ id: 'f1', qty: 10, price: 100 }));
    mgr.applyFill('order-1', makeFill({ id: 'f2', qty: 10, price: 110 }));
    // avg = (10*100 + 10*110) / 20 = 105
    expect(mgr.getOrder('order-1')!.avgFillPrice).toBe(105);
  });

  it('does nothing for an unknown order id', () => {
    expect(() => new OrderStateManager().applyFill('missing', makeFill())).not.toThrow();
  });
});

describe('markCanceled / markRejected', () => {
  it('markCanceled sets status to canceled and closedAt', () => {
    const mgr = new OrderStateManager();
    mgr.addOrder(makeOrder());
    mgr.markCanceled('order-1');
    expect(mgr.getOrder('order-1')!.status).toBe('canceled');
    expect(mgr.getOrder('order-1')!.closedAt).toBe(1_000);
  });

  it('markRejected sets status to rejected and closedAt', () => {
    const mgr = new OrderStateManager();
    mgr.addOrder(makeOrder());
    mgr.markRejected('order-1');
    expect(mgr.getOrder('order-1')!.status).toBe('rejected');
    expect(mgr.getOrder('order-1')!.closedAt).toBe(1_000);
  });
});

describe('pruneClosedOrders', () => {
  it('removes closed orders older than the retention window', () => {
    const mgr = new OrderStateManager();
    const closedOrder = makeOrder({ id: 'o-old', status: 'filled', closedAt: 100 });
    mgr.addOrder(closedOrder);
    mgr.addOrder(makeOrder({ id: 'o-open', status: 'submitted' }));

    mockNowMs.mockReturnValue(3_700_000); // way past 1h retention
    mgr.pruneClosedOrders(3_600_000);

    expect(mgr.getOrder('o-old')).toBeNull();
    expect(mgr.getOrder('o-open')).not.toBeNull();
  });

  it('keeps closed orders within the retention window', () => {
    const mgr = new OrderStateManager();
    mgr.addOrder(makeOrder({ id: 'o-recent', status: 'filled', closedAt: 900 }));
    mockNowMs.mockReturnValue(1_000);
    mgr.pruneClosedOrders(3_600_000); // cutoff = 1000 - 3600000 < 0, so order survives
    expect(mgr.getOrder('o-recent')).not.toBeNull();
  });
});

describe('clear', () => {
  it('removes all orders', () => {
    const mgr = new OrderStateManager();
    mgr.addOrder(makeOrder({ id: 'o1' }));
    mgr.addOrder(makeOrder({ id: 'o2' }));
    mgr.clear();
    expect(mgr.getAllOrders()).toHaveLength(0);
  });
});
