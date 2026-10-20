jest.mock('../../config/env', () => ({
  env: { alpacaApiKey: 'k', alpacaApiSecret: 's', logLevel: 'error' },
}));

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileBarCache } from '../../adapters/localfs/fileBarCache';
import { BacktestLoader } from '../../core/backtest/backtestLoader';
import type { Bar } from '../../types/market';

const DAY1 = Date.parse('2026-10-06T00:00:00Z');
const DAY2 = Date.parse('2026-10-07T00:00:00Z');
const MIN = 60_000;

function bar(ts: number, close: number, extra: Partial<Bar> = {}): Bar {
  return {
    symbol: 'SPY', ts, isoTs: new Date(ts).toISOString(), timeframe: '1Min',
    open: close, high: close, low: close, close, volume: 100, ...extra,
  } as Bar;
}

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bar-cache-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('FileBarCache', () => {
  it('reads back bars across days, half-open on the end', async () => {
    const cache = new FileBarCache(root);
    const bars = [bar(DAY1 + 14 * 60 * MIN, 1, { vwap: 1.1, tradeCount: 7 }), bar(DAY2 + 14 * 60 * MIN, 2)];
    await cache.writeBars('SPY', '1Min', bars);

    expect(await cache.readBars('SPY', '1Min', DAY1, DAY2 + 86_400_000)).toEqual(bars);
    expect(await cache.readBars('SPY', '1Min', DAY1, bars[1].ts)).toEqual([bars[0]]);
    // A fresh instance reads what the first one wrote.
    expect(await new FileBarCache(root).readBars('SPY', '1Min', DAY1, DAY2 + 86_400_000)).toEqual(bars);
  });

  it('upserts: a re-fetched bar replaces the cached one and the day stays sorted', async () => {
    const cache = new FileBarCache(root);
    await cache.writeBars('SPY', '1Min', [bar(DAY1 + 2 * MIN, 2), bar(DAY1 + 4 * MIN, 4)]);
    await cache.writeBars('SPY', '1Min', [bar(DAY1 + 3 * MIN, 3), bar(DAY1 + 4 * MIN, 40)]);

    const closes = (await cache.readBars('SPY', '1Min', DAY1, DAY2)).map((b) => b.close);
    expect(closes).toEqual([2, 3, 40]);
  });

  it('serializes concurrent writes to one day without losing bars', async () => {
    const cache = new FileBarCache(root);
    await Promise.all([1, 2, 3, 4].map((i) => cache.writeBars('SPY', '1Min', [bar(DAY1 + i * MIN, i)])));
    expect(await cache.readBars('SPY', '1Min', DAY1, DAY2)).toHaveLength(4);
  });

  it('only markComplete makes a day complete, including a known-empty day', async () => {
    const cache = new FileBarCache(root);
    await cache.writeBars('SPY', '1Min', [bar(DAY1 + MIN, 1)]);
    expect(await cache.getCompleteDays('SPY', '1Min', '2026-10-01', '2026-10-31')).toEqual(new Set());

    await cache.markComplete('SPY', '1Min', [{ day: '2026-10-06', barCount: 1 }, { day: '2026-10-04', barCount: 0 }]);
    expect(await cache.getCompleteDays('SPY', '1Min', '2026-10-04', '2026-10-06')).toEqual(new Set(['2026-10-04', '2026-10-06']));
    expect(await cache.getCompleteDays('SPY', '1Min', '2026-10-05', '2026-10-05')).toEqual(new Set());
    expect(await cache.getCompleteDays('SPY', '1Day', '2026-10-01', '2026-10-31')).toEqual(new Set());
  });

  it('throws on a corrupt day file so the loader re-fetches, and a rewrite repairs it', async () => {
    const cache = new FileBarCache(root);
    await cache.writeBars('SPY', '1Min', [bar(DAY1 + MIN, 1)]);
    const file = path.join(root, 'sip', 'bars', '1Min', 'SPY', '2026-10-06.json.gz');
    await fs.writeFile(file, 'not gzip');

    await expect(cache.readBars('SPY', '1Min', DAY1, DAY2)).rejects.toThrow();
    await cache.writeBars('SPY', '1Min', [bar(DAY1 + 2 * MIN, 2)]);
    expect((await cache.readBars('SPY', '1Min', DAY1, DAY2)).map((b) => b.close)).toEqual([2]);
  });

  it('serves a second load entirely from disk', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        bars: ['2024-01-15T14:30:00Z', '2024-01-15T14:31:00Z'].map((t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1, vw: 1, n: 1 })),
        next_page_token: null,
      }),
    }) as unknown as typeof fetch;
    const loader = () => new BacktestLoader({ cache: new FileBarCache(root), now: () => Date.parse('2024-06-01T12:00:00Z') });

    const first = await loader().loadBars(['SPY'], '2024-01-15T00:00:00Z', '2024-01-16T00:00:00Z');
    const fetches = (global.fetch as jest.Mock).mock.calls.length;
    const second = await loader().loadBars(['SPY'], '2024-01-15T00:00:00Z', '2024-01-16T00:00:00Z');

    expect(first).toHaveLength(2);
    expect(second.map((b) => b.ts)).toEqual(first.map((b) => b.ts));
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(fetches);
  });
});
