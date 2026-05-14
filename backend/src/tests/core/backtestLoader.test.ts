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

describe('loadBars: deterministic same-timestamp ordering', () => {
  it('breaks ties on equal timestamps by symbol ascending', async () => {
    // Three symbols at the same minute; the fetch order is INTENTIONALLY not
    // alphabetical to prove the sort is stable regardless of fetch order.
    const sharedTs = '2024-01-15T09:30:00Z';
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ bars: [alpacaBar(sharedTs, 200)] }) }) // SPY first
      .mockResolvedValueOnce({ ok: true, json: async () => ({ bars: [alpacaBar(sharedTs, 100)] }) }) // AAPL
      .mockResolvedValueOnce({ ok: true, json: async () => ({ bars: [alpacaBar(sharedTs, 300)] }) }); // MSFT
    const loader = new BacktestLoader();
    const bars = await loader.loadBars(['SPY', 'AAPL', 'MSFT'], START, END);
    expect(bars.map((b) => b.symbol)).toEqual(['AAPL', 'MSFT', 'SPY']);
  });

  it('is stable across runs with shuffled same-timestamp input order', async () => {
    const sharedTs = '2024-01-15T09:30:00Z';

    // Run 1: input order [QQQ, SPY, AAPL]
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ bars: [alpacaBar(sharedTs)] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ bars: [alpacaBar(sharedTs)] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ bars: [alpacaBar(sharedTs)] }) });
    const order1 = (await new BacktestLoader().loadBars(['QQQ', 'SPY', 'AAPL'], START, END)).map((b) => b.symbol);

    (global.fetch as jest.Mock).mockReset();

    // Run 2: input order [SPY, AAPL, QQQ] — must produce the SAME ordering.
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ bars: [alpacaBar(sharedTs)] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ bars: [alpacaBar(sharedTs)] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ bars: [alpacaBar(sharedTs)] }) });
    const order2 = (await new BacktestLoader().loadBars(['SPY', 'AAPL', 'QQQ'], START, END)).map((b) => b.symbol);

    expect(order1).toEqual(['AAPL', 'QQQ', 'SPY']);
    expect(order2).toEqual(order1);
  });

  it('preserves timestamp-ascending order across symbols with mixed equal/unequal timestamps', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          bars: [alpacaBar('2024-01-15T09:31:00Z'), alpacaBar('2024-01-15T09:30:00Z')],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          bars: [alpacaBar('2024-01-15T09:30:00Z'), alpacaBar('2024-01-15T09:32:00Z')],
        }),
      });
    const bars = await new BacktestLoader().loadBars(['SPY', 'AAPL'], START, END);

    // First two are 09:30 sorted by symbol; then 09:31 SPY; then 09:32 AAPL.
    expect(bars[0].ts).toEqual(bars[1].ts);
    expect(bars[0].symbol).toBe('AAPL');
    expect(bars[1].symbol).toBe('SPY');
    expect(bars[2].ts).toBeGreaterThan(bars[1].ts);
    expect(bars[2].symbol).toBe('SPY');
    expect(bars[3].symbol).toBe('AAPL');
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
