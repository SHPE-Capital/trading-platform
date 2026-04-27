jest.mock('ws');
jest.mock('../../config/env', () => ({
  env: {
    alpacaApiKey: 'test-key',
    alpacaApiSecret: 'test-secret',
    alpacaDataStreamUrl: 'wss://stream.data.alpaca.markets/v2',
    alpacaTradingMode: 'paper',
    alpacaPaperBaseUrl: 'https://paper-api.alpaca.markets',
    alpacaLiveBaseUrl: 'https://api.alpaca.markets',
    alpacaPaperStreamUrl: 'wss://paper-api.alpaca.markets/stream',
    alpacaLiveStreamUrl: 'wss://api.alpaca.markets/stream',
    supabaseUrl: 'https://test.supabase.co',
    supabaseAnonKey: 'test-anon',
    supabaseServiceRoleKey: 'test-service',
    port: 8080,
    nodeEnv: 'test',
    corsOrigin: 'http://localhost:3000',
    logLevel: 'error',
    defaultRollingWindowMs: 60_000,
    maxPositionSizeUsd: 10_000,
    maxNotionalExposureUsd: 50_000,
    orderCooldownMs: 5_000,
    enableLiveTrading: false,
    enableWebSocketPush: true,
    databaseUrl: '',
  },
}));

import { AlpacaOrderExecutionAdapter } from '../../adapters/alpaca/orderExecution';
import { EventBus } from '../../core/engine/eventBus';
import type { OrderIntent } from '../../types/orders';

const intent: OrderIntent = {
  id: 'intent-1',
  strategyId: 'strat-1',
  symbol: 'SPY',
  side: 'buy',
  qty: 10,
  orderType: 'market',
  timeInForce: 'day',
  ts: Date.now(),
};

const alpacaOrderResponse = {
  id: 'alpaca-order-id-1',
  client_order_id: 'intent-1',
  status: 'accepted',
  symbol: 'SPY',
  side: 'buy',
  qty: '10',
  filled_qty: '0',
  type: 'market',
  time_in_force: 'day',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function makeAdapter() {
  const eventBus = new EventBus();
  jest.spyOn(eventBus, 'publish');
  const adapter = new AlpacaOrderExecutionAdapter(eventBus, 'paper');
  return { adapter, eventBus };
}

function callTradeStream(adapter: AlpacaOrderExecutionAdapter, data: unknown): void {
  (adapter as unknown as {
    _handleTradeStreamMessage: (d: unknown) => void;
  })._handleTradeStreamMessage(
    typeof data === 'string' ? data : JSON.stringify(data),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

describe('AlpacaOrderExecutionAdapter: submitOrder', () => {
  it('returns an Order with status submitted and filledQty 0 on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => alpacaOrderResponse,
    });
    const { adapter } = makeAdapter();
    const order = await adapter.submitOrder(intent);
    expect(order.status).toBe('submitted');
    expect(order.filledQty).toBe(0);
    expect(order.brokerOrderId).toBe('alpaca-order-id-1');
    expect(order.symbol).toBe('SPY');
    expect(order.qty).toBe(10);
  });

  it('publishes ORDER_SUBMITTED event on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => alpacaOrderResponse,
    });
    const { adapter, eventBus } = makeAdapter();
    await adapter.submitOrder(intent);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ORDER_SUBMITTED',
        payload: expect.objectContaining({ id: 'intent-1', symbol: 'SPY' }),
      }),
    );
  });

  it('throws when the API response is not ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => 'Insufficient funds',
    });
    const { adapter } = makeAdapter();
    await expect(adapter.submitOrder(intent)).rejects.toThrow('422');
  });
});

describe('AlpacaOrderExecutionAdapter: cancelOrder', () => {
  it('does not throw when response is ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
    const { adapter } = makeAdapter();
    await expect(adapter.cancelOrder('alpaca-order-id-1')).resolves.toBeUndefined();
  });

  it('does not throw when status is 204 (Alpaca cancel-accepted)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 204, text: async () => '' });
    const { adapter } = makeAdapter();
    await expect(adapter.cancelOrder('alpaca-order-id-1')).resolves.toBeUndefined();
  });

  it('throws when the API returns an error status', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'order not found',
    });
    const { adapter } = makeAdapter();
    await expect(adapter.cancelOrder('bad-id')).rejects.toThrow('404');
  });
});

describe('AlpacaOrderExecutionAdapter: paper trade fill flow', () => {
  it('publishes ORDER_FILLED with correct price and qty after fill event', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => alpacaOrderResponse,
    });
    const { adapter, eventBus } = makeAdapter();

    const order = await adapter.submitOrder(intent);
    expect(order.status).toBe('submitted');
    expect(order.filledQty).toBe(0);

    const fillMsg = {
      stream: 'trade_updates',
      data: {
        event: 'fill',
        price: '502.50',
        order: {
          client_order_id: intent.id,
          id: 'alpaca-order-id-1',
          symbol: 'SPY',
          side: 'buy',
          filled_qty: '10',
          updated_at: new Date().toISOString(),
        },
      },
    };
    callTradeStream(adapter, fillMsg);

    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ORDER_FILLED',
        fill: expect.objectContaining({
          price: 502.5,
          qty: 10,
          symbol: 'SPY',
        }),
      }),
    );
  });
});

describe('AlpacaOrderExecutionAdapter: trade update events', () => {
  it('publishes ORDER_CANCELED on canceled event', () => {
    const { adapter, eventBus } = makeAdapter();
    callTradeStream(adapter, {
      stream: 'trade_updates',
      data: {
        event: 'canceled',
        order: { client_order_id: 'intent-1', id: 'alpaca-order-id-1' },
      },
    });
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ORDER_CANCELED', orderId: 'intent-1' }),
    );
  });

  it('publishes ORDER_REJECTED on rejected event', () => {
    const { adapter, eventBus } = makeAdapter();
    callTradeStream(adapter, {
      stream: 'trade_updates',
      data: {
        event: 'rejected',
        reason: 'margin call',
        order: { client_order_id: 'intent-1', id: 'alpaca-order-id-1' },
      },
    });
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ORDER_REJECTED', orderId: 'intent-1' }),
    );
  });

  it('does not throw on malformed JSON', () => {
    const { adapter } = makeAdapter();
    expect(() => callTradeStream(adapter, 'not-valid-json')).not.toThrow();
  });
});
