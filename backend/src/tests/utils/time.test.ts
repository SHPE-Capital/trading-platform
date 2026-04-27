import {
  isoToMs,
  msToIso,
  isStale,
  formatTs,
  timeframeToMs,
  startOfDayUtcMs,
} from '../../utils/time';

const ISO = '2024-01-15T10:30:00.000Z';
const MS = new Date(ISO).getTime();

describe('isoToMs', () => {
  it('converts an ISO 8601 string to Unix milliseconds', () => {
    expect(isoToMs(ISO)).toBe(MS);
  });

  it('returns a positive number for a valid ISO string', () => {
    expect(isoToMs(ISO)).toBeGreaterThan(0);
  });
});

describe('msToIso', () => {
  it('converts Unix ms to an ISO 8601 string', () => {
    expect(msToIso(MS)).toBe(ISO);
  });

  it('round-trips with isoToMs', () => {
    expect(msToIso(isoToMs(ISO))).toBe(ISO);
  });
});

describe('isStale', () => {
  it('returns true when timestamp age exceeds threshold', () => {
    expect(isStale(1_000, 500, 2_000)).toBe(true); // age=1000 > threshold=500
  });

  it('returns false when timestamp age is within threshold', () => {
    expect(isStale(1_600, 500, 2_000)).toBe(false); // age=400 < threshold=500
  });

  it('returns false when timestamp age equals threshold (not strictly greater)', () => {
    expect(isStale(1_500, 500, 2_000)).toBe(false); // age=500, not > 500
  });

  it('uses Date.now() when nowOverride is omitted', () => {
    const recent = Date.now();
    expect(isStale(recent, 1_000)).toBe(false);
    expect(isStale(recent - 2_000, 1_000)).toBe(true);
  });
});

describe('formatTs', () => {
  it('returns a non-empty string', () => {
    expect(typeof formatTs(MS)).toBe('string');
    expect(formatTs(MS).length).toBeGreaterThan(0);
  });
});

describe('timeframeToMs', () => {
  it('converts seconds', () => {
    expect(timeframeToMs('30s')).toBe(30_000);
    expect(timeframeToMs('1s')).toBe(1_000);
  });

  it('converts minutes', () => {
    expect(timeframeToMs('1m')).toBe(60_000);
    expect(timeframeToMs('5m')).toBe(300_000);
  });

  it('converts hours', () => {
    expect(timeframeToMs('1h')).toBe(3_600_000);
    expect(timeframeToMs('4h')).toBe(14_400_000);
  });

  it('converts days', () => {
    expect(timeframeToMs('1d')).toBe(86_400_000);
    expect(timeframeToMs('2d')).toBe(172_800_000);
  });

  it('throws for an unknown timeframe unit', () => {
    expect(() => timeframeToMs('1x')).toThrow('Unknown timeframe unit');
  });
});

describe('startOfDayUtcMs', () => {
  it('returns a timestamp that is evenly divisible by 86400000 (midnight UTC)', () => {
    const ms = startOfDayUtcMs();
    expect(ms % 86_400_000).toBe(0);
  });

  it('returns a number less than or equal to Date.now()', () => {
    expect(startOfDayUtcMs()).toBeLessThanOrEqual(Date.now());
  });
});
