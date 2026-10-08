// One handler registry per socket: an automocked class shares a single `on`
// mock across instances, which would fire every socket's handlers at once.
jest.mock('ws', () => jest.fn().mockImplementation(() => {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    handlers,
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => { (handlers[event] ??= []).push(handler); }),
    send: jest.fn(),
    close: jest.fn(),
    ping: jest.fn(),
    terminate: jest.fn(),
  };
}));
jest.mock('../../config/env', () => ({
  env: {
    alpacaApiKey: 'test-key',
    alpacaApiSecret: 'test-secret',
    alpacaTradingMode: 'paper',
    alpacaPaperBaseUrl: 'https://paper-api.alpaca.markets',
    alpacaLiveBaseUrl: 'https://api.alpaca.markets',
    alpacaPaperStreamUrl: 'wss://paper-api.alpaca.markets/stream',
    alpacaLiveStreamUrl: 'wss://api.alpaca.markets/stream',
    logLevel: 'error',
  },
}));

import WebSocket from 'ws';
import { AlpacaOrderExecutionAdapter } from '../../adapters/alpaca/orderExecution';
import { EventBus } from '../../core/engine/eventBus';

const MockWebSocket = WebSocket as unknown as jest.Mock;

type FakeSocket = Record<'on' | 'send' | 'close' | 'ping' | 'terminate', jest.Mock> & {
  handlers: Record<string, Array<(...args: unknown[]) => void>>;
};

const socketsOpened = () => MockWebSocket.mock.results.length;

/** The newest socket the adapter opened, with a way to fire its handlers. */
function latestSocket() {
  const results = MockWebSocket.mock.results;
  const ws = results[results.length - 1].value as FakeSocket;
  const emit = (event: string, ...args: unknown[]) => {
    for (const handler of ws.handlers[event] ?? []) handler(...args);
  };
  return { ws, emit };
}

function authorize(socket: ReturnType<typeof latestSocket>) {
  socket.emit('message', JSON.stringify({ stream: 'authorization', data: { action: 'authenticate', status: 'authorized' } }));
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function makeAdapter() {
  const eventBus = new EventBus();
  const published: Array<Record<string, unknown>> = [];
  jest.spyOn(eventBus, 'publish').mockImplementation((e) => { published.push(e as unknown as Record<string, unknown>); });
  return { adapter: new AlpacaOrderExecutionAdapter(eventBus, 'paper'), published };
}

async function connected(adapter: AlpacaOrderExecutionAdapter) {
  const pending = adapter.connectTradeStream();
  const socket = latestSocket();
  socket.emit('open');
  authorize(socket);
  await pending;
  return socket;
}

beforeEach(() => {
  jest.useFakeTimers();
  MockWebSocket.mockClear();
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('trade stream reconnect', () => {
  it('reconnects after an unexpected close and tells reconnect handlers', async () => {
    const { adapter } = makeAdapter();
    const onReconnect = jest.fn();
    adapter.onReconnect(onReconnect);
    const first = await connected(adapter);

    first.emit('close');
    jest.advanceTimersByTime(999);
    expect(socketsOpened()).toBe(1);
    jest.advanceTimersByTime(1);
    expect(socketsOpened()).toBe(2);

    authorize(latestSocket());
    await flush();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially while attempts keep failing, then resets once connected', async () => {
    const { adapter } = makeAdapter();
    (await connected(adapter)).emit('close');

    jest.advanceTimersByTime(1_000);
    expect(socketsOpened()).toBe(2);
    latestSocket().emit('close'); // attempt failed before authorizing
    jest.advanceTimersByTime(1_999);
    expect(socketsOpened()).toBe(2);
    jest.advanceTimersByTime(1);
    expect(socketsOpened()).toBe(3);

    authorize(latestSocket());
    await flush();
    latestSocket().emit('close');
    jest.advanceTimersByTime(1_000); // back to the base delay
    expect(socketsOpened()).toBe(4);
  });

  it('stays closed after a deliberate disconnect()', async () => {
    const { adapter } = makeAdapter();
    const socket = await connected(adapter);

    adapter.disconnect();
    socket.emit('close');
    jest.advanceTimersByTime(60_000);
    expect(socketsOpened()).toBe(1);
  });

  it('closes an unauthorized socket so the retry path takes over', async () => {
    const { adapter } = makeAdapter();
    const pending = adapter.connectTradeStream().catch((err: Error) => err);
    const socket = latestSocket();
    socket.emit('message', JSON.stringify({ stream: 'authorization', data: { action: 'auth', message: 'code=401, message=Unauthorized', status: 'unauthorized' } }));

    expect(await pending).toBeInstanceOf(Error);
    expect(socket.ws.close).toHaveBeenCalled();
  });
});

describe('trade stream heartbeat', () => {
  it('keeps a socket that answers pings', async () => {
    const { adapter } = makeAdapter();
    const socket = await connected(adapter);

    jest.advanceTimersByTime(30_000);
    expect(socket.ws.ping).toHaveBeenCalledTimes(1);
    socket.emit('pong');
    jest.advanceTimersByTime(30_000);
    expect(socket.ws.ping).toHaveBeenCalledTimes(2);
    expect(socket.ws.terminate).not.toHaveBeenCalled();
  });

  it('terminates a half-open socket that stops answering, which then reconnects', async () => {
    const { adapter } = makeAdapter();
    const socket = await connected(adapter);

    jest.advanceTimersByTime(60_000); // ping, then no pong by the next beat
    expect(socket.ws.terminate).toHaveBeenCalledTimes(1);

    socket.emit('close'); // what terminate() produces on a real socket
    jest.advanceTimersByTime(1_000);
    expect(socketsOpened()).toBe(2);
  });
});

describe('reconcileOrders', () => {
  function restReturns(orders: Record<string, Record<string, unknown>>) {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      const id = new URL(url).searchParams.get('client_order_id')!;
      return { ok: true, json: async () => ({ client_order_id: id, symbol: 'MU', side: 'sell', qty: '5', ...orders[id] }) };
    });
  }

  it('publishes fills and terminal states the stream missed', async () => {
    const { adapter, published } = makeAdapter();
    restReturns({
      filled: { status: 'filled', filled_qty: '5', filled_avg_price: '1065.42' },
      canceled: { status: 'canceled', filled_qty: '0' },
      partial: { status: 'canceled', filled_qty: '2', filled_avg_price: '1065.00' },
      open: { status: 'new', filled_qty: '0' },
    });

    const count = await adapter.reconcileOrders([
      { id: 'filled', filledQty: 0 },
      { id: 'canceled', filledQty: 0 },
      { id: 'partial', filledQty: 0 },
      { id: 'open', filledQty: 0 },
    ]);

    expect(count).toBe(4);
    expect(published.map((e) => `${e.type}:${e.orderId}`)).toEqual([
      'ORDER_FILLED:filled',
      'ORDER_CANCELED:canceled',
      'ORDER_PARTIAL_FILL:partial',
      'ORDER_CANCELED:partial',
    ]);
    expect(published[0]).toMatchObject({ fill: { qty: 5, price: 1065.42 } });
    expect(published[2]).toMatchObject({ fill: { qty: 2 }, remainingQty: 3 });
  });

  it('publishes only the part of a fill the engine has not seen', async () => {
    const { adapter, published } = makeAdapter();
    restReturns({ o1: { status: 'filled', filled_qty: '5', filled_avg_price: '10' } });

    await adapter.reconcileOrders([{ id: 'o1', filledQty: 3 }]);

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ type: 'ORDER_FILLED', fill: { qty: 2 } });
  });

  it('never re-publishes a fill the stream already delivered', async () => {
    const { adapter, published } = makeAdapter();
    // The stream delivered the fill, but the engine's order record missed it
    // (the fill raced ahead of the submit response).
    (adapter as unknown as { _handleTradeStreamMessage: (d: string) => void })._handleTradeStreamMessage(JSON.stringify({
      stream: 'trade_updates',
      data: { event: 'fill', price: '10', qty: '5', order: { client_order_id: 'o1', symbol: 'MU', side: 'sell', qty: '5', filled_qty: '5' } },
    }));
    published.length = 0;
    restReturns({ o1: { status: 'filled', filled_qty: '5', filled_avg_price: '10' } });

    expect(await adapter.reconcileOrders([{ id: 'o1', filledQty: 0 }])).toBe(0);
    expect(published).toHaveLength(0);
  });

  it('skips an order it cannot read back and carries on', async () => {
    const { adapter, published } = makeAdapter();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'order not found' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ client_order_id: 'b', symbol: 'MU', side: 'buy', qty: '1', status: 'filled', filled_qty: '1', filled_avg_price: '5' }) });

    expect(await adapter.reconcileOrders([{ id: 'a', filledQty: 0 }, { id: 'b', filledQty: 0 }])).toBe(1);
    expect(published.map((e) => e.type)).toEqual(['ORDER_FILLED']);
  });
});
