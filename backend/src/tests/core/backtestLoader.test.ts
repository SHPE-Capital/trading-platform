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

import { BacktestLoader } from '../../core/backtest/backtestLoader';

const START = '2024-01-15T09:00:00Z';
const END = '2024-01-15T16:00:00Z';

function alpacaBar(isoTs: string, close = 100) {
  return { t: isoTs, o: close, h: close + 1, l: close - 1, c: close, v: 1_000, vw: close, n: 10 };
}

beforeEach(() => {
  global.fetch = jest.fn();
});

describe('loadBars: success', () => {
  it('returns an empty array when API returns no bars', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ bars: [] }),
    });
    const loader = new BacktestLoader();
    const bars = await loader.loadBars(['SPY'], START, END);
    expect(bars).toHaveLength(0);
  });

  it('normalizes raw Alpaca bars and attaches the correct symbol', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ bars: [alpacaBar('2024-01-15T09:30:00Z', 100)] }),
    });
    const loader = new BacktestLoader();
    const bars = await loader.loadBars(['SPY'], START, END);
    expect(bars).toHaveLength(1);
    expect(bars[0].symbol).toBe('SPY');
    expect(bars[0].close).toBe(100);
  });

  it('sorts bars from multiple symbols by timestamp ascending', async () => {
    // SPY bar at 09:31, AAPL bar at 09:30 — result should be AAPL first
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bars: [alpacaBar('2024-01-15T09:31:00Z', 200)] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bars: [alpacaBar('2024-01-15T09:30:00Z', 100)] }),
      });
    const loader = new BacktestLoader();
    const bars = await loader.loadBars(['SPY', 'AAPL'], START, END);
    expect(bars).toHaveLength(2);
    expect(bars[0].ts).toBeLessThanOrEqual(bars[1].ts);
    expect(bars[0].symbol).toBe('AAPL');
    expect(bars[1].symbol).toBe('SPY');
  });

  it('follows pagination via next_page_token', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          bars: [alpacaBar('2024-01-15T09:30:00Z')],
          next_page_token: 'page-2-token',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          bars: [alpacaBar('2024-01-15T09:31:00Z')],
          // no next_page_token → stop pagination
        }),
      });
    const loader = new BacktestLoader();
    const bars = await loader.loadBars(['SPY'], START, END);
    expect(bars).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    // Second call should include page_token in query string
    const secondUrl = (global.fetch as jest.Mock).mock.calls[1][0] as string;
    expect(secondUrl).toContain('page_token=page-2-token');
  });
});

describe('loadBars: error handling', () => {
  it('throws when the API returns a non-ok response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });
    const loader = new BacktestLoader();
    await expect(loader.loadBars(['SPY'], START, END)).rejects.toThrow('SPY');
  });
});
