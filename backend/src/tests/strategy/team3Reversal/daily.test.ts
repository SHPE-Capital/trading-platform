import { dailyPnl, etDate } from '../../../strategies/team3Reversal/contract/daily';

const IS = { startDate: '2026-09-01T00:00:00Z', endDate: '2026-10-15T23:59:59Z' };
const at = (iso: string, equity: number) => ({ ts: Date.parse(iso), equity });

describe('dailyPnl: one P&L per ET trading day', () => {
  it('first day is measured against starting capital, later days against the previous close', () => {
    const d = dailyPnl([
      at('2026-09-01T14:00:00Z', 100_050), at('2026-09-01T19:59:00Z', 100_100),
      at('2026-09-02T19:59:00Z', 99_900),
    ], 100_000, IS);
    expect(d).toEqual([{ date: '2026-09-01', pnl: 100 }, { date: '2026-09-02', pnl: -200 }]);
  });

  it('buckets by New York date, not UTC (a 21:00 ET bar is still the same ET day)', () => {
    expect(etDate(Date.parse('2026-09-02T01:00:00Z'))).toBe('2026-09-01');
  });

  it('folds the wall-clock final snapshot into the last real day instead of adding a phantom day', () => {
    const curve = [
      at('2026-10-14T19:59:00Z', 100_200), at('2026-10-15T19:55:00Z', 100_300),
      at('2026-11-22T17:00:00Z', 100_310),   // engine's final MTM, stamped with the run date
    ];
    const d = dailyPnl(curve, 100_000, IS);
    expect(d.map((x) => x.date)).toEqual(['2026-10-14', '2026-10-15']);
    expect(d[1].pnl).toBe(110);
    expect(d.reduce((s, x) => s + x.pnl, 0)).toBe(310);   // sum of days == net P&L
  });

  it('ignores points before the window and accepts ISO / numeric-string timestamps from saved JSON', () => {
    const d = dailyPnl([
      { ts: Date.parse('2026-08-31T19:00:00Z'), equity: 1 },
      { ts: '2026-09-01T19:00:00Z' as unknown as number, equity: 100_020 },
      { ts: String(Date.parse('2026-09-02T19:00:00Z')) as unknown as number, equity: 100_030 },
    ], 100_000, IS);
    expect(d).toEqual([{ date: '2026-09-01', pnl: 20 }, { date: '2026-09-02', pnl: 10 }]);
  });
});
