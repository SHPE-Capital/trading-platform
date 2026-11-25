import { SessionHistory } from '../../../strategies/team3Reversal/history';
import { MINUTE, OPEN_ET, fakeBar } from './helpers';

const DAY_MS = 24 * 60 * MINUTE;

describe('SessionHistory: today\'s regular-session bars only', () => {
  it('ignores pre-market and after-hours bars', () => {
    const h = new SessionHistory();
    expect(h.ingest('AAPL', fakeBar(-1, 90, 1_000, OPEN_ET))).toBe(false);    // 9:29
    expect(h.ingest('AAPL', fakeBar(0, 100, 1_000, OPEN_ET))).toBe(true);     // 9:30
    expect(h.ingest('AAPL', fakeBar(390, 120, 1_000, OPEN_ET))).toBe(false);  // 16:00
    expect(h.today('AAPL').map((b) => b.close)).toEqual([100]);
    expect(h.vwap('AAPL', 60)?.vwap).toBeCloseTo(100);
  });

  it('is idempotent per bar: the same or an older bar is not added twice', () => {
    const h = new SessionHistory();
    h.ingest('AAPL', fakeBar(5, 100, 1_000, OPEN_ET));
    expect(h.ingest('AAPL', fakeBar(5, 100, 1_000, OPEN_ET))).toBe(false);
    expect(h.ingest('AAPL', fakeBar(4, 100, 1_000, OPEN_ET))).toBe(false);
    expect(h.today('AAPL')).toHaveLength(1);
  });

  it('starts fresh each New York day: yesterday never becomes the previous bar', () => {
    const h = new SessionHistory();
    h.ingest('AAPL', fakeBar(389, 100, 1_000, OPEN_ET));
    h.ingest('AAPL', fakeBar(0, 103, 1_000, OPEN_ET + DAY_MS));
    expect(h.today('AAPL').map((b) => b.close)).toEqual([103]);
    expect(h.vwap('AAPL', 60)?.vwap).toBeCloseTo(103);
  });

  it('keeps symbols apart', () => {
    const h = new SessionHistory();
    h.ingest('AAPL', fakeBar(0, 100, 1_000, OPEN_ET));
    h.ingest('SPY', fakeBar(0, 500, 1_000, OPEN_ET));
    expect(h.today('SPY').map((b) => b.close)).toEqual([500]);
    expect(h.today('MSFT')).toEqual([]);
  });
});
