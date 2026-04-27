jest.mock('../../config/env', () => ({
  env: {
    alpacaApiKey: 'test-key',
    alpacaApiSecret: 'test-secret',
    alpacaTradingMode: 'paper',
    alpacaPaperBaseUrl: 'https://paper-api.alpaca.markets',
    alpacaLiveBaseUrl: 'https://api.alpaca.markets',
    alpacaDataStreamUrl: 'wss://stream.data.alpaca.markets/v2',
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

import { SymbolStateManager } from '../../core/state/symbolState';
import type { Quote, Trade, Bar } from '../../types/market';

function makeQuote(symbol: string, mid = 100, ts = 1_000): Quote {
  return {
    symbol,
    bidPrice: mid - 0.05,
    askPrice: mid + 0.05,
    bidSize: 100,
    askSize: 100,
    midPrice: mid,
    spread: 0.1,
    microPrice: mid,
    imbalance: 0,
    ts,
    isoTs: new Date(ts).toISOString(),
  };
}

function makeTrade(symbol: string, price = 100, size = 50, ts = 1_000): Trade {
  return {
    symbol,
    price,
    size,
    ts,
    isoTs: new Date(ts).toISOString(),
  };
}

function makeBar(symbol: string, close = 100, ts = 1_000): Bar {
  return {
    symbol,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 10_000,
    ts,
    isoTs: new Date(ts).toISOString(),
    timeframe: '1m',
  };
}

describe('getOrCreate / get / getSymbols', () => {
  it('getOrCreate returns an initial state for a new symbol', () => {
    const mgr = new SymbolStateManager();
    const state = mgr.getOrCreate('SPY');
    expect(state.symbol).toBe('SPY');
    expect(state.latestQuote).toBeNull();
    expect(state.latestTrade).toBeNull();
    expect(state.latestBar).toBeNull();
    expect(state.quoteCount).toBe(0);
    expect(state.tradeCount).toBe(0);
    expect(state.barCount).toBe(0);
  });

  it('getOrCreate returns the same object on subsequent calls', () => {
    const mgr = new SymbolStateManager();
    const a = mgr.getOrCreate('SPY');
    const b = mgr.getOrCreate('SPY');
    expect(a).toBe(b);
  });

  it('get returns null for an untracked symbol', () => {
    expect(new SymbolStateManager().get('AAPL')).toBeNull();
  });

  it('getSymbols returns all tracked symbols', () => {
    const mgr = new SymbolStateManager();
    mgr.getOrCreate('SPY');
    mgr.getOrCreate('AAPL');
    expect(mgr.getSymbols()).toEqual(expect.arrayContaining(['SPY', 'AAPL']));
    expect(mgr.getSymbols()).toHaveLength(2);
  });
});

describe('onQuote', () => {
  it('updates all latest quote fields', () => {
    const mgr = new SymbolStateManager();
    const quote = makeQuote('SPY', 200, 5_000);
    mgr.onQuote(quote);
    const state = mgr.get('SPY')!;
    expect(state.latestQuote).toEqual(quote);
    expect(state.latestBid).toBe(199.95);
    expect(state.latestAsk).toBe(200.05);
    expect(state.latestMid).toBe(200);
    expect(state.latestSpread).toBe(0.1);
  });

  it('increments quoteCount on each call', () => {
    const mgr = new SymbolStateManager();
    mgr.onQuote(makeQuote('SPY'));
    mgr.onQuote(makeQuote('SPY'));
    expect(mgr.get('SPY')!.quoteCount).toBe(2);
  });

  it('creates state for unseen symbol', () => {
    const mgr = new SymbolStateManager();
    mgr.onQuote(makeQuote('NVDA'));
    expect(mgr.get('NVDA')).not.toBeNull();
  });

  it('pushes to midprices and spreads rolling windows', () => {
    const mgr = new SymbolStateManager();
    mgr.onQuote(makeQuote('SPY', 100, 1_000));
    mgr.onQuote(makeQuote('SPY', 101, 2_000));
    const state = mgr.get('SPY')!;
    expect(state.midpricesWindow.size()).toBe(2);
    expect(state.spreadsWindow.size()).toBe(2);
  });
});

describe('onTrade', () => {
  it('updates latestTrade and increments tradeCount', () => {
    const mgr = new SymbolStateManager();
    const trade = makeTrade('AAPL', 185, 100, 3_000);
    mgr.onTrade(trade);
    const state = mgr.get('AAPL')!;
    expect(state.latestTrade).toEqual(trade);
    expect(state.tradeCount).toBe(1);
  });

  it('pushes to tradesWindow', () => {
    const mgr = new SymbolStateManager();
    mgr.onTrade(makeTrade('AAPL', 185, 100, 1_000));
    mgr.onTrade(makeTrade('AAPL', 186, 50, 2_000));
    expect(mgr.get('AAPL')!.tradesWindow.size()).toBe(2);
  });
});

describe('onBar', () => {
  it('updates latestBar and increments barCount', () => {
    const mgr = new SymbolStateManager();
    const bar = makeBar('QQQ', 350, 10_000);
    mgr.onBar(bar);
    const state = mgr.get('QQQ')!;
    expect(state.latestBar).toEqual(bar);
    expect(state.barCount).toBe(1);
  });
});

describe('clear', () => {
  it('removes all tracked symbol states', () => {
    const mgr = new SymbolStateManager();
    mgr.onQuote(makeQuote('SPY'));
    mgr.onTrade(makeTrade('AAPL'));
    mgr.clear();
    expect(mgr.getSymbols()).toHaveLength(0);
  });
});
