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

import { AlpacaMarketDataAdapter } from '../../adapters/alpaca/marketData';
import { EventBus } from '../../core/engine/eventBus';

const ISO = '2024-01-15T10:30:00.000Z';

function makeAdapter() {
  const eventBus = new EventBus();
  jest.spyOn(eventBus, 'publish');
  const adapter = new AlpacaMarketDataAdapter(eventBus, 'paper');
  return { adapter, eventBus };
}

function msg(data: unknown): Buffer {
  return Buffer.from(JSON.stringify(data));
}

// Helper to call the private _handleMessage method
function handleMessage(
  adapter: AlpacaMarketDataAdapter,
  data: unknown,
  resolve?: (v: void) => void,
  reject?: (err: Error) => void,
): void {
  (adapter as unknown as {
    _handleMessage: (d: Buffer, r?: (v: void) => void, j?: (e: Error) => void) => void
  })._handleMessage(msg(data), resolve, reject);
}

describe('AlpacaMarketDataAdapter: auth flow', () => {
  it('resolves the connect promise on authenticated success message', (done) => {
    const { adapter } = makeAdapter();
    const resolve = () => done();
    const reject = (err: Error) => done(err);
    handleMessage(adapter, [{ T: 'success', msg: 'authenticated' }], resolve, reject);
  });

  it('rejects the connect promise on error message', (done) => {
    const { adapter } = makeAdapter();
    const resolve = () => done(new Error('should not resolve'));
    const reject = (err: Error) => {
      expect(err.message).toContain('bad credentials');
      done();
    };
    handleMessage(adapter, [{ T: 'error', msg: 'bad credentials' }], resolve, reject);
  });
});

describe('AlpacaMarketDataAdapter: message handling', () => {
  it('publishes QUOTE_RECEIVED when message type is "q"', () => {
    const { adapter, eventBus } = makeAdapter();
    handleMessage(adapter, [{
      T: 'q',
      S: 'SPY',
      bp: 100.0,
      ap: 100.1,
      bs: 200,
      as: 100,
      t: ISO,
    }]);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'QUOTE_RECEIVED',
        payload: expect.objectContaining({
          symbol: 'SPY',
          midPrice: 100.05,
        }),
      }),
    );
  });

  it('publishes TRADE_RECEIVED when message type is "t"', () => {
    const { adapter, eventBus } = makeAdapter();
    handleMessage(adapter, [{
      T: 't',
      S: 'AAPL',
      p: 185.5,
      s: 300,
      t: ISO,
    }]);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TRADE_RECEIVED',
        payload: expect.objectContaining({ symbol: 'AAPL', price: 185.5 }),
      }),
    );
  });

  it('publishes BAR_RECEIVED when message type is "b"', () => {
    const { adapter, eventBus } = makeAdapter();
    handleMessage(adapter, [{
      T: 'b',
      S: 'QQQ',
      o: 350,
      h: 355,
      l: 349,
      c: 353,
      v: 1_000_000,
      t: ISO,
    }]);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BAR_RECEIVED',
        payload: expect.objectContaining({ symbol: 'QQQ', close: 353 }),
      }),
    );
  });

  it('does not throw on malformed JSON', () => {
    const { adapter } = makeAdapter();
    expect(() => {
      (adapter as unknown as { _handleMessage: (d: Buffer) => void })
        ._handleMessage(Buffer.from('not-valid-json'));
    }).not.toThrow();
  });

  it('does not publish events for unhandled message types', () => {
    const { adapter, eventBus } = makeAdapter();
    handleMessage(adapter, [{ T: 'subscription', symbols: ['SPY'] }]);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});

describe('AlpacaMarketDataAdapter: subscribe/unsubscribe', () => {
  it('warns and does not call ws.send when not connected', () => {
    const { adapter } = makeAdapter();
    // isConnected is false by default
    const mockWs = { send: jest.fn() };
    (adapter as unknown as { ws: unknown }).ws = mockWs;
    // isConnected is still false
    adapter.subscribe(['SPY']);
    expect(mockWs.send).not.toHaveBeenCalled();
  });

  it('sends subscription message when connected', () => {
    const { adapter } = makeAdapter();
    const mockWs = { send: jest.fn() };
    (adapter as unknown as { ws: unknown; isConnected: boolean }).ws = mockWs;
    (adapter as unknown as { isConnected: boolean }).isConnected = true;
    adapter.subscribe(['SPY', 'AAPL']);
    expect(mockWs.send).toHaveBeenCalledWith(
      JSON.stringify({ action: 'subscribe', quotes: ['SPY', 'AAPL'], trades: ['SPY', 'AAPL'], bars: ['SPY', 'AAPL'] }),
    );
  });

  it('sends unsubscribe message', () => {
    const { adapter } = makeAdapter();
    const mockWs = { send: jest.fn() };
    (adapter as unknown as { ws: unknown }).ws = mockWs;
    adapter.unsubscribe(['SPY']);
    expect(mockWs.send).toHaveBeenCalledWith(
      JSON.stringify({ action: 'unsubscribe', quotes: ['SPY'], trades: ['SPY'], bars: ['SPY'] }),
    );
  });
});
