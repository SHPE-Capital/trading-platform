import { MarketDataMonitor, feedFromStreamUrl, STALE_AFTER_MS } from '../../core/live/marketDataMonitor';
import type { MarketHours } from '../../core/market/marketHours';

const NOW = Date.parse('2026-10-27T15:00:00Z');
const open: MarketHours = { isOpen: () => true };
const closed: MarketHours = { isOpen: () => false };

function busStub() {
  const handlers: Record<string, Array<(e: unknown) => void>> = {};
  return {
    on: (type: string, fn: (e: unknown) => void) => { (handlers[type] ??= []).push(fn); },
    emit: (type: string) => handlers[type]?.forEach((fn) => fn({ type })),
  };
}

function monitor(opts: { source?: 'alpaca-stream' | 'none'; connected?: boolean; hours?: MarketHours } = {}) {
  let now = NOW;
  let connected = opts.connected ?? true;
  const bus = busStub();
  const m = new MarketDataMonitor({
    source: opts.source ?? 'alpaca-stream',
    feed: 'iex',
    isConnected: () => connected,
    marketHours: opts.hours ?? open,
    now: () => now,
  });
  m.attach(bus as never);
  return {
    m,
    bar: () => bus.emit('BAR_RECEIVED'),
    advance: (ms: number) => { now += ms; },
    setConnected: (v: boolean) => { connected = v; },
  };
}

describe('MarketDataMonitor', () => {
  it('reports no_data when the runtime has no data keys', () => {
    const { m } = monitor({ source: 'none' });
    expect(m.status()).toMatchObject({ source: 'none', feed: null, state: 'no_data' });
    expect(m.status().message).toMatch(/Alpaca/);
  });

  it('reports disconnected while the stream is down', () => {
    const { m } = monitor({ connected: false });
    m.noteSubscribed(['SPY']);
    expect(m.status().state).toBe('disconnected');
  });

  it('reports idle when connected but nothing is subscribed', () => {
    const { m } = monitor();
    expect(m.status()).toMatchObject({ state: 'idle', subscribedSymbols: 0 });
  });

  it('goes back to idle once every subscribed symbol is released', () => {
    const { m } = monitor();
    m.noteSubscribed(['SPY', 'QQQ']);
    m.noteUnsubscribed(['SPY', 'QQQ']);
    expect(m.status()).toMatchObject({ state: 'idle', subscribedSymbols: 0 });
  });

  it('is live while bars keep arriving', () => {
    const { m, bar, advance } = monitor();
    m.noteSubscribed(['SPY', 'QQQ', 'SPY']);
    bar();
    advance(STALE_AFTER_MS - 1);
    expect(m.status()).toMatchObject({ state: 'live', subscribedSymbols: 2, lastBarAt: NOW });
  });

  it('goes stale when no bar arrives in market hours', () => {
    const { m, bar, advance } = monitor();
    m.noteSubscribed(['SPY']);
    bar();
    advance(STALE_AFTER_MS + 1);
    expect(m.status().state).toBe('stale');
  });

  it('is stale, not live, when subscribed in market hours and no bar ever arrived', () => {
    const { m } = monitor();
    m.noteSubscribed(['SPY']);
    expect(m.status().state).toBe('stale');
  });

  it('reports market_closed instead of stale outside the session', () => {
    const { m } = monitor({ hours: closed });
    m.noteSubscribed(['SPY']);
    expect(m.status().state).toBe('market_closed');
  });

  it('still reports live for extended-hours bars arriving while the session is closed', () => {
    const { m, bar } = monitor({ hours: closed });
    m.noteSubscribed(['SPY']);
    bar();
    expect(m.status().state).toBe('live');
  });

  it('stamps runs with the source and feed only', () => {
    expect(monitor().m.runStamp()).toEqual({ source: 'alpaca-stream', feed: 'iex' });
    expect(monitor({ source: 'none' }).m.runStamp()).toEqual({ source: 'none', feed: null });
  });
});

describe('feedFromStreamUrl', () => {
  it.each([
    ['wss://stream.data.alpaca.markets/v2/iex', 'iex'],
    ['wss://stream.data.alpaca.markets/v2/sip/', 'sip'],
    ['wss://stream.data.alpaca.markets/v2/test', 'test'],
    ['not a url', 'unknown'],
  ])('%s -> %s', (url, feed) => {
    expect(feedFromStreamUrl(url)).toBe(feed);
  });
});
