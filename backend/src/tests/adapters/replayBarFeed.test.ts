jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { ReplayBarFeed, type ReplayTimers } from '../../adapters/replay/replayBarFeed';
import type { Bar } from '../../types/market';

const MIN = 60_000;
const T0 = Date.parse('2026-10-06T13:30:00Z');

function bar(symbol: string, ts: number, close = 100): Bar {
  return { symbol, ts, isoTs: new Date(ts).toISOString(), open: close, high: close, low: close, close, volume: 10, timeframe: '1Min' };
}

/** Timers that run only when stepped, recording each requested delay. */
function manualTimers(now = 1_000_000) {
  const queue: Array<{ fn: () => void; ms: number }> = [];
  const timers: ReplayTimers = {
    setTimeout: (fn, ms) => { queue.push({ fn, ms }); return queue.length; },
    clearTimeout: () => { queue.length = 0; },
    now: () => now,
  };
  return {
    timers,
    delays: () => queue.map((q) => q.ms),
    step: () => { const next = queue.shift(); next?.fn(); return next?.ms; },
  };
}

function setup(barsBySymbol: Record<string, Bar[]>, speed = 1) {
  const published: Bar[] = [];
  const eventBus = { publish: jest.fn((e: { payload: Bar }) => published.push(e.payload)) };
  const source = {
    readBars: jest.fn(async (symbol: string, _tf: string, start: number, end: number) =>
      (barsBySymbol[symbol] ?? []).filter((b) => b.ts >= start && b.ts <= end)),
  };
  const t = manualTimers();
  const feed = new ReplayBarFeed(eventBus as never, 'paper', source, { fromMs: T0 - MIN, toMs: T0 + 10 * 24 * 60 * MIN, speed }, t.timers);
  return { feed, published, source, ...t };
}

describe('ReplayBarFeed', () => {
  it('publishes bars minute by minute, re-stamped with the publish time', async () => {
    const { feed, published, step } = setup({ SPY: [bar('SPY', T0), bar('SPY', T0 + MIN, 101)] });
    feed.subscribe(['SPY']);
    await feed.connect();
    expect(step()).toBe(0);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ symbol: 'SPY', close: 100, ts: 1_000_000, timeframe: '1m' });
    expect(step()).toBe(MIN);
    expect(published[1].close).toBe(101);
  });

  it('publishes every symbol of a minute together', async () => {
    const { feed, published, step } = setup({ SPY: [bar('SPY', T0)], QQQ: [bar('QQQ', T0)] });
    feed.subscribe(['SPY', 'QQQ']);
    await feed.connect();
    step();
    expect(published.map((b) => b.symbol).sort()).toEqual(['QQQ', 'SPY']);
  });

  it('skips overnight gaps instead of waiting them out', async () => {
    const nextDay = T0 + 24 * 60 * MIN;
    const { feed, step } = setup({ SPY: [bar('SPY', T0), bar('SPY', nextDay)] });
    feed.subscribe(['SPY']);
    await feed.connect();
    step();
    expect(step()).toBe(MIN);
  });

  it('compresses wall-clock time at higher speeds', async () => {
    const { feed, step } = setup({ SPY: [bar('SPY', T0), bar('SPY', T0 + MIN)] }, 10);
    feed.subscribe(['SPY']);
    await feed.connect();
    step();
    expect(step()).toBe(MIN / 10);
  });

  it('joins a symbol subscribed mid-replay from the current position', async () => {
    const { feed, published, source, step } = setup({
      SPY: [bar('SPY', T0), bar('SPY', T0 + MIN), bar('SPY', T0 + 2 * MIN)],
      QQQ: [bar('QQQ', T0), bar('QQQ', T0 + MIN), bar('QQQ', T0 + 2 * MIN)],
    });
    feed.subscribe(['SPY']);
    await feed.connect();
    step(); // T0 SPY
    feed.subscribe(['QQQ']);
    await new Promise((r) => setImmediate(r));
    expect(source.readBars).toHaveBeenLastCalledWith('QQQ', '1Min', T0 + 1, expect.any(Number));
    step(); // T0+1 SPY + QQQ
    expect(published.slice(1).map((b) => b.symbol).sort()).toEqual(['QQQ', 'SPY']);
  });

  it('stops publishing after disconnect', async () => {
    const { feed, published, delays } = setup({ SPY: [bar('SPY', T0), bar('SPY', T0 + MIN)] });
    feed.subscribe(['SPY']);
    await feed.connect();
    feed.disconnect();
    expect(delays()).toHaveLength(0);
    expect(published).toHaveLength(0);
  });
});
