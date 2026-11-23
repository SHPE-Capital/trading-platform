import { applyFilter, eventSymbol, isEmptyFilter } from '../../core/replay/replayFilter';
import type { TradingEvent } from '../../types/events';

const quote = (symbol: string, ts: number) =>
  ({ id: `q-${symbol}-${ts}`, type: 'QUOTE_RECEIVED', ts, mode: 'paper', payload: { symbol } }) as unknown as TradingEvent;
const fill = (symbol: string, ts: number) =>
  ({ id: `f-${ts}`, type: 'ORDER_FILLED', ts, mode: 'paper', orderId: 'o', fill: { symbol } }) as unknown as TradingEvent;
const rejection = (symbol: string, ts: number) =>
  ({ id: `r-${ts}`, type: 'RISK_REJECTED', ts, mode: 'paper', strategyId: 's', reason: 'x', rejectedIntent: { symbol } }) as unknown as TradingEvent;
const heartbeat = (ts: number) =>
  ({ id: `h-${ts}`, type: 'HEARTBEAT', ts, mode: 'paper' }) as TradingEvent;

const events = [quote('SPY', 1), quote('QQQ', 2), fill('SPY', 3), heartbeat(4), rejection('QQQ', 5)];

describe('eventSymbol', () => {
  it('reads the symbol from payload, fill or rejected intent', () => {
    expect(eventSymbol(events[0])).toBe('SPY');
    expect(eventSymbol(events[2])).toBe('SPY');
    expect(eventSymbol(events[4])).toBe('QQQ');
    expect(eventSymbol(events[3])).toBeUndefined();
  });
});

describe('applyFilter', () => {
  it('returns everything for an empty filter, without mutating the input', () => {
    const copy = [...events];
    expect(applyFilter(events, {})).toEqual(events);
    expect(events).toEqual(copy);
  });

  it('keeps only the listed event types', () => {
    expect(applyFilter(events, { eventTypes: ['ORDER_FILLED', 'HEARTBEAT'] }).map((e) => e.ts)).toEqual([3, 4]);
  });

  it('keeps matching symbols (case-insensitive) and events without a symbol', () => {
    expect(applyFilter(events, { symbols: ['spy'] }).map((e) => e.ts)).toEqual([1, 3, 4]);
  });

  it('applies inclusive time bounds', () => {
    expect(applyFilter(events, { startTs: 2, endTs: 4 }).map((e) => e.ts)).toEqual([2, 3, 4]);
  });

  it('ANDs all fields', () => {
    expect(applyFilter(events, { symbols: ['QQQ'], eventTypes: ['RISK_REJECTED', 'QUOTE_RECEIVED'], startTs: 3 })
      .map((e) => e.ts)).toEqual([5]);
  });
});

describe('isEmptyFilter', () => {
  it('treats missing and empty fields as empty', () => {
    expect(isEmptyFilter({})).toBe(true);
    expect(isEmptyFilter({ eventTypes: [], symbols: [] })).toBe(true);
    expect(isEmptyFilter({ startTs: 0 })).toBe(false);
    expect(isEmptyFilter({ symbols: ['SPY'] })).toBe(false);
  });
});
