import { TEAM3_WINDOWS, oosLocked } from '../../../strategies/team3Reversal/contract/protocol';

describe('OOS window and the Stage 3 lock', () => {
  it('OOS runs 2026-10-16 -> 2026-11-20 (extended from 11-13 by the lead, 2026-11-23)', () => {
    expect(TEAM3_WINDOWS.out).toEqual({ startDate: '2026-10-16T00:00:00Z', endDate: '2026-11-20T23:59:59Z' });
  });

  it('refuses a run ending 2026-11-20 without --stage3, allows it with', () => {
    expect(oosLocked('2026-11-20T23:59:59Z', false)).toBe(true);
    expect(oosLocked('2026-11-20T23:59:59Z', true)).toBe(false);
  });

  it('refuses the old OOS end and any day after the in-sample window', () => {
    expect(oosLocked('2026-11-13T23:59:59Z', false)).toBe(true);
    expect(oosLocked('2026-10-16T23:59:59Z', false)).toBe(true);
  });

  it('allows in-sample runs', () => {
    expect(oosLocked(TEAM3_WINDOWS.in.endDate, false)).toBe(false);
  });
});
