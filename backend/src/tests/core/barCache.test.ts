jest.mock('../../config/env', () => ({
  env: { alpacaApiKey: 'k', alpacaApiSecret: 's', logLevel: 'error' },
}));

import { BacktestLoader } from '../../core/backtest/backtestLoader';
import { splitIntoRuns, utcDaysInRange, type BarCache } from '../../core/backtest/barCache';
import type { Bar } from '../../types/market';

function bar(symbol: string, iso: string, close = 100): Bar {
  const ts = Date.parse(iso);
  return { symbol, ts, isoTs: iso, open: close, high: close, low: close, close, volume: 1, timeframe: '1Min' };
}

function alpacaPage(isos: string[], nextPageToken?: string) {
  return {
    ok: true,
    json: async () => ({
      bars: isos.map((t) => ({ t, o: 100, h: 101, l: 99, c: 100, v: 1, vw: 100, n: 1 })),
      next_page_token: nextPageToken,
    }),
  };
}

/** In-memory BarCache that records every call. */
function memoryCache(completeDays: string[], stored: Bar[] = []) {
  const bars = [...stored];
  const cache = {
    getCompleteDays: jest.fn(async (_s: string, _tf: string, from: string, to: string) =>
      new Set(completeDays.filter((d) => d >= from && d <= to))),
    readBars: jest.fn(async (s: string, _tf: string, start: number, end: number) =>
      bars.filter((b) => b.symbol === s && b.ts >= start && b.ts < end).sort((a, b) => a.ts - b.ts)),
    writeBars: jest.fn(async (_s: string, _tf: string, written: Bar[]) => { bars.push(...written); }),
    markComplete: jest.fn(async (_s: string, _tf: string, _days: { day: string; barCount: number }[]) => {}),
  };
  return cache as typeof cache & BarCache;
}

const NOW = Date.parse('2024-06-01T12:00:00Z');

beforeEach(() => {
  global.fetch = jest.fn();
});

describe('day helpers', () => {
  it('lists every UTC day in range, excluding an end that sits exactly on midnight', () => {
    expect(utcDaysInRange(Date.parse('2024-01-15T00:00:00Z'), Date.parse('2024-01-17T00:00:00Z')))
      .toEqual(['2024-01-15', '2024-01-16']);
    expect(utcDaysInRange(Date.parse('2024-01-15T09:00:00Z'), Date.parse('2024-01-15T16:00:00Z')))
      .toEqual(['2024-01-15']);
  });

  it('splits days into alternating cached / uncached runs', () => {
    const runs = splitIntoRuns(['a', 'b', 'c', 'd'], new Set(['a', 'b', 'd']));
    expect(runs).toEqual([
      { cached: true, days: ['a', 'b'] },
      { cached: false, days: ['c'] },
      { cached: true, days: ['d'] },
    ]);
  });
});

describe('BacktestLoader with a bar cache', () => {
  const START = '2024-01-15T00:00:00Z';
  const END = '2024-01-17T00:00:00Z'; // days 15 and 16

  it('serves fully cached days with zero Alpaca requests', async () => {
    const cache = memoryCache(['2024-01-15', '2024-01-16'], [
      bar('SPY', '2024-01-15T14:30:00Z'),
      bar('SPY', '2024-01-16T14:30:00Z'),
    ]);
    const bars = await new BacktestLoader({ cache, now: () => NOW }).loadBars(['SPY'], START, END);

    expect(bars.map((b) => b.ts)).toEqual([Date.parse('2024-01-15T14:30:00Z'), Date.parse('2024-01-16T14:30:00Z')]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches only the uncached days, backfills them, and marks them complete', async () => {
    const cache = memoryCache(['2024-01-15'], [bar('SPY', '2024-01-15T14:30:00Z')]);
    (global.fetch as jest.Mock).mockResolvedValueOnce(alpacaPage(['2024-01-16T14:30:00Z', '2024-01-16T14:31:00Z']));

    const bars = await new BacktestLoader({ cache, now: () => NOW }).loadBars(['SPY'], START, END);

    expect(bars).toHaveLength(3);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    // The fetch covers the whole uncached day, not the original request range.
    expect(decodeURIComponent(url)).toContain('start=2024-01-16T00:00:00.000Z');
    expect(cache.writeBars).toHaveBeenCalledWith('SPY', '1Min', expect.arrayContaining([expect.any(Object)]));
    expect(cache.markComplete).toHaveBeenCalledWith('SPY', '1Min', [{ day: '2024-01-16', barCount: 2 }]);
  });

  it('records a genuinely empty day as complete with zero bars, so it is never refetched', async () => {
    const cache = memoryCache([]);
    (global.fetch as jest.Mock).mockResolvedValue(alpacaPage([]));

    await new BacktestLoader({ cache, now: () => NOW }).loadBars(['SPY'], START, END);

    expect(cache.markComplete).toHaveBeenCalledWith('SPY', '1Min', [
      { day: '2024-01-15', barCount: 0 },
      { day: '2024-01-16', barCount: 0 },
    ]);
  });

  it('never marks recent days complete — Alpaca still revises them', async () => {
    const cache = memoryCache([]);
    (global.fetch as jest.Mock).mockResolvedValue(alpacaPage(['2024-06-01T14:30:00Z']));
    const loader = new BacktestLoader({ cache, now: () => NOW, settleDays: 1 });

    await loader.loadBars(['SPY'], '2024-05-31T00:00:00Z', '2024-06-01T23:00:00Z');

    expect(cache.writeBars).toHaveBeenCalled();
    expect(cache.markComplete).not.toHaveBeenCalled();
  });

  it('falls back to Alpaca when the cache cannot be read', async () => {
    const cache = memoryCache([]);
    cache.getCompleteDays.mockRejectedValue(new Error('relation "bar_coverage" does not exist'));
    (global.fetch as jest.Mock).mockResolvedValue(alpacaPage(['2024-01-15T14:30:00Z']));

    const bars = await new BacktestLoader({ cache, now: () => NOW }).loadBars(['SPY'], START, END);

    expect(bars).toHaveLength(1);
    expect(cache.writeBars).not.toHaveBeenCalled();
  });

  it('leaves days uncovered when a backfill write fails, so they are retried next run', async () => {
    const cache = memoryCache([]);
    cache.writeBars.mockRejectedValue(new Error('timeout'));
    (global.fetch as jest.Mock).mockResolvedValue(alpacaPage(['2024-01-15T14:30:00Z']));

    const bars = await new BacktestLoader({ cache, now: () => NOW }).loadBars(['SPY'], START, END);

    expect(bars).toHaveLength(1); // the backtest itself is unaffected
    expect(cache.markComplete).not.toHaveBeenCalled();
  });

  it('a second identical load issues no Alpaca requests', async () => {
    const cache = memoryCache([]);
    cache.markComplete.mockImplementation(async (_s: string, _tf: string, days: { day: string }[]) => {
      // Promote marked days into the cache's complete set for the next load.
      cache.getCompleteDays.mockImplementation(async () => new Set(days.map((d) => d.day)));
    });
    (global.fetch as jest.Mock).mockResolvedValue(alpacaPage(['2024-01-15T14:30:00Z', '2024-01-16T14:30:00Z']));
    const loader = new BacktestLoader({ cache, now: () => NOW });

    const first = await loader.loadBars(['SPY'], START, END);
    (global.fetch as jest.Mock).mockClear();
    const second = await loader.loadBars(['SPY'], START, END);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(second.map((b) => b.ts)).toEqual(first.map((b) => b.ts));
  });
});
