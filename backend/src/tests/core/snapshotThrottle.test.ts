import { SnapshotThrottle, moneyKey } from '../../core/persistence/snapshotThrottle';

describe('SnapshotThrottle', () => {
  it('writes the first snapshot, skips repeats, and writes again on change', () => {
    const t = new SnapshotThrottle(60_000);
    expect(t.shouldWrite('book', 'a', 0)).toBe(true);
    expect(t.shouldWrite('book', 'a', 10_000)).toBe(false);
    expect(t.shouldWrite('book', 'b', 20_000)).toBe(true);
    expect(t.shouldWrite('book', 'b', 30_000)).toBe(false);
  });

  it('writes an unchanged snapshot once the heartbeat is due', () => {
    const t = new SnapshotThrottle(60_000);
    t.shouldWrite('book', 'a', 0);
    expect(t.shouldWrite('book', 'a', 59_999)).toBe(false);
    expect(t.shouldWrite('book', 'a', 60_000)).toBe(true);
  });

  it('tracks each series separately and forgets stopped ones', () => {
    const t = new SnapshotThrottle(60_000);
    t.shouldWrite('run-1', 'a', 0);
    t.shouldWrite('run-2', 'a', 0);
    expect(t.shouldWrite('run-1', 'a', 1)).toBe(false);
    t.retain(['run-2']);
    expect(t.shouldWrite('run-1', 'a', 2)).toBe(true);
    expect(t.shouldWrite('run-2', 'a', 2)).toBe(false);
  });
});

describe('moneyKey', () => {
  it('ignores sub-cent float noise', () => {
    expect(moneyKey(100.001, 5)).toBe(moneyKey(100.004, 5));
    expect(moneyKey(100.01, 5)).not.toBe(moneyKey(100.02, 5));
  });
});
