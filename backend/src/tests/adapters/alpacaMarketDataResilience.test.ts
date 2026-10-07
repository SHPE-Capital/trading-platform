// One handler registry per socket (see alpacaTradeStreamResilience.test.ts).
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
    alpacaDataStreamUrl: 'wss://stream.data.alpaca.markets/v2/iex',
    logLevel: 'error',
  },
}));

import WebSocket from 'ws';
import { AlpacaMarketDataAdapter } from '../../adapters/alpaca/marketData';
import { EventBus } from '../../core/engine/eventBus';

const MockWebSocket = WebSocket as unknown as jest.Mock;
type FakeSocket = Record<'on' | 'send' | 'close' | 'ping' | 'terminate', jest.Mock> & {
  handlers: Record<string, Array<(...args: unknown[]) => void>>;
};

const socketsOpened = () => MockWebSocket.mock.results.length;

function latestSocket() {
  const results = MockWebSocket.mock.results;
  const ws = results[results.length - 1].value as FakeSocket;
  const emit = (event: string, ...args: unknown[]) => {
    for (const handler of ws.handlers[event] ?? []) handler(...args);
  };
  return { ws, emit };
}

async function connected(adapter: AlpacaMarketDataAdapter) {
  const pending = adapter.connect();
  const socket = latestSocket();
  socket.emit('open');
  socket.emit('message', Buffer.from(JSON.stringify([{ T: 'success', msg: 'authenticated' }])));
  await pending;
  return socket;
}

beforeEach(() => {
  jest.useFakeTimers();
  MockWebSocket.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('AlpacaMarketDataAdapter resilience', () => {
  it('reconnects and restores subscriptions after an unexpected close', async () => {
    const adapter = new AlpacaMarketDataAdapter(new EventBus(), 'paper');
    const first = await connected(adapter);
    adapter.subscribe(['NVDA', 'SPCX']);

    first.emit('close');
    jest.advanceTimersByTime(5_000);
    expect(socketsOpened()).toBe(2);

    const second = latestSocket();
    second.emit('message', Buffer.from(JSON.stringify([{ T: 'success', msg: 'authenticated' }])));
    expect(second.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ action: 'subscribe', quotes: ['NVDA', 'SPCX'], trades: ['NVDA', 'SPCX'], bars: ['NVDA', 'SPCX'] }),
    );
  });

  it('stays closed after a deliberate disconnect()', async () => {
    const adapter = new AlpacaMarketDataAdapter(new EventBus(), 'paper');
    const socket = await connected(adapter);

    adapter.disconnect();
    socket.emit('close');
    jest.advanceTimersByTime(60_000);
    expect(socketsOpened()).toBe(1);
  });

  it('terminates a half-open socket that stops answering pings', async () => {
    const adapter = new AlpacaMarketDataAdapter(new EventBus(), 'paper');
    const socket = await connected(adapter);

    jest.advanceTimersByTime(30_000);
    expect(socket.ws.ping).toHaveBeenCalledTimes(1);
    socket.emit('pong');
    jest.advanceTimersByTime(30_000);
    expect(socket.ws.terminate).not.toHaveBeenCalled();

    jest.advanceTimersByTime(30_000); // the second ping went unanswered
    expect(socket.ws.terminate).toHaveBeenCalledTimes(1);
    socket.emit('close');
    jest.advanceTimersByTime(5_000);
    expect(socketsOpened()).toBe(2);
  });
});
