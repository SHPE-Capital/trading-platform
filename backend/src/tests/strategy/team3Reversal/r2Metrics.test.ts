import { r2Metrics } from '../../../runtime/team3Metrics/r2';
import type { MetricBar, RoundTrip } from '../../../runtime/team3Metrics/trades';

// 2026-10-06 and 2026-10-07, 9:30 ET (13:30 UTC).
const D1 = Date.UTC(2026, 9, 6, 13, 30), D2 = Date.UTC(2026, 9, 7, 13, 30);
const bar = (ts: number, open: number, close: number): MetricBar => ({ ts, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 });
const trip = (symbol: string, entryTs: number, reason: string): RoundTrip => ({
  symbol, side: 'buy', entryTs, exitTs: entryTs + 60_000, qty: 1, qtyWanted: 1, entryClose: 100, entryZ: -2, edgeBps: 20, reason, barsHeld: 30, pnlBpsGross: 10,
});

describe('r2Metrics', () => {
  it('splits time stops by trend day (top quartile of |close-open|/open)', () => {
    const bars = new Map<string, MetricBar[]>([
      ['AAA', [bar(D1, 100, 100), bar(D1 + 60_000, 100, 100.1), bar(D2, 100, 100), bar(D2 + 60_000, 100, 105)]],
      ['BBB', [bar(D1, 100, 100.2), bar(D2, 100, 100.3)]],
    ]);
    const out = r2Metrics({
      signals: [], daily: [], config: {}, barsBySymbol: bars,
      roundTrips: [trip('AAA', D2 + 60_000, 'time'), trip('AAA', D1, 'time'), trip('BBB', D2, 'target')],
    });
    expect(out).toMatchObject({ symbolDays: 4, trendSymbolDays: 1, timeStopsTrendDays: 1, timeStopsNonTrendDays: 1, tradesTrendDays: 1, tradesNonTrendDays: 2, grossBpsPerTrade: 10 });
  });

  it('is empty with no input', () => {
    expect(r2Metrics({ signals: [], roundTrips: [], barsBySymbol: new Map(), daily: [], config: {} })).toEqual({});
  });
});
