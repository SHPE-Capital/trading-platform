/**
 * core/persistence/snapshotThrottle.ts
 *
 * Decides which periodic snapshots are worth a database row. The runtime
 * samples the book every minute around the clock, but outside market hours
 * (about 80% of a week) nothing moves, so most of those rows repeat the one
 * before. A snapshot is written when its content changed since the last write
 * for that series, or when the heartbeat is due, so charts still get a point at
 * least once an hour.
 */

export const SNAPSHOT_HEARTBEAT_MS = 60 * 60_000;

export class SnapshotThrottle {
  private readonly last = new Map<string, { key: string; at: number }>();

  constructor(private readonly heartbeatMs = SNAPSHOT_HEARTBEAT_MS) {}

  /**
   * True when the snapshot for `series` should be written now; records it as
   * written. `key` is any string that changes when the snapshot's content does.
   */
  shouldWrite(series: string, key: string, now: number): boolean {
    const prev = this.last.get(series);
    if (prev && prev.key === key && now - prev.at < this.heartbeatMs) return false;
    this.last.set(series, { key, at: now });
    return true;
  }

  /** Drops series no longer sampled (a run that stopped), so the map does not grow. */
  retain(series: Iterable<string>): void {
    const keep = new Set(series);
    for (const id of this.last.keys()) if (!keep.has(id)) this.last.delete(id);
  }
}

/** Cents are the resolution that matters for a snapshot; float noise below that is not a change. */
export function moneyKey(...values: number[]): string {
  return values.map((v) => (Number.isFinite(v) ? v.toFixed(2) : String(v))).join("|");
}
