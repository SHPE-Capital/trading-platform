import { AlpacaClockHours, regularSessionHours, alwaysOpen, type MarketHours } from '../../core/market/marketHours';

jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const at = (iso: string) => Date.parse(iso);

describe('regularSessionHours', () => {
  it('is open 09:30–16:00 New York time on weekdays (EDT)', () => {
    expect(regularSessionHours.isOpen(at('2026-10-07T13:29:00Z'))).toBe(false); // 09:29 EDT
    expect(regularSessionHours.isOpen(at('2026-10-07T13:30:00Z'))).toBe(true);  // 09:30 EDT
    expect(regularSessionHours.isOpen(at('2026-10-07T19:59:00Z'))).toBe(true);  // 15:59 EDT
    expect(regularSessionHours.isOpen(at('2026-10-07T20:00:00Z'))).toBe(false); // 16:00 EDT
  });

  it('follows standard time in winter (EST)', () => {
    expect(regularSessionHours.isOpen(at('2026-12-07T14:29:00Z'))).toBe(false); // 09:29 EST
    expect(regularSessionHours.isOpen(at('2026-12-07T14:30:00Z'))).toBe(true);  // 09:30 EST
  });

  it('is closed at weekends and overnight', () => {
    expect(regularSessionHours.isOpen(at('2026-10-10T15:00:00Z'))).toBe(false); // Saturday
    expect(regularSessionHours.isOpen(at('2026-10-07T04:21:00Z'))).toBe(false); // 00:21 EDT
  });

  it('alwaysOpen is open at any time', () => {
    expect(alwaysOpen.isOpen(at('2026-10-10T03:00:00Z'))).toBe(true);
  });
});

describe('AlpacaClockHours', () => {
  const closedFallback: MarketHours = { isOpen: () => false };

  it('trusts the reported window until it lapses, then falls back', async () => {
    const hours = new AlpacaClockHours(async () => ({
      is_open: true,
      next_open: '2026-10-08T13:30:00Z',
      next_close: '2026-10-07T20:00:00Z',
    }), closedFallback);
    await hours.refresh();
    expect(hours.isOpen(at('2026-10-07T19:59:00Z'))).toBe(true);
    expect(hours.isOpen(at('2026-10-07T20:00:00Z'))).toBe(false);
  });

  it('reports a holiday closure the regular session would miss', async () => {
    const hours = new AlpacaClockHours(async () => ({
      is_open: false,
      next_open: '2026-11-27T14:30:00Z',
      next_close: '2026-11-27T18:00:00Z',
    }));
    await hours.refresh();
    expect(hours.isOpen(at('2026-11-26T16:00:00Z'))).toBe(false); // Thanksgiving, a Thursday
  });

  it('uses the fallback before the first successful refresh', async () => {
    const hours = new AlpacaClockHours(async () => { throw new Error('offline'); }, closedFallback);
    await hours.refresh();
    expect(hours.isOpen(at('2026-10-07T15:00:00Z'))).toBe(false);
  });
});
