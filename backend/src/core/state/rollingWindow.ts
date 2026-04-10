/**
 * core/state/rollingWindow.ts
 *
 * Generic time-based rolling window. Stores timestamped values and
 * automatically evicts entries older than the configured window duration.
 *
 * This is the foundational building block for all in-memory state:
 * quotes, trades, spreads, midprices, returns, and strategy-specific values.
 *
 * Design choices:
 * - Uses a plain array (deque-style access) for simplicity.
 * - Eviction happens on every push — acceptable at the initial scale.
 * - Fully generic: works with any value type T.
 *
 * Inputs:  windowMs (duration), push(TimedValue<T>) calls.
 * Outputs: getItems(), getLatest(), statistics via helper methods.
 */

/** A timestamped value stored in the rolling window */
export interface TimedValue<T> {
  /** Unix timestamp in milliseconds */
  ts: number;
  /** The stored value */
  value: T;
}

export class RollingTimeWindow<T> {
  private items: TimedValue<T>[] = [];

  /**
   * Creates a new rolling time window.
   * @param windowMs - Duration of the window in milliseconds.
   *                   Entries older than this from the most recent push are evicted.
   */
  constructor(private readonly windowMs: number) {}

  /**
   * Appends a new timestamped value to the window and evicts stale entries.
   * @param item - A TimedValue containing the timestamp and value
   */
  push(item: TimedValue<T>): void {
    this.items.push(item);
    this.evict(item.ts);
  }

  /**
   * Removes all entries whose timestamp is older than (nowTs - windowMs).
   * Should be called after every push.
   * @param nowTs - The reference "current" time in Unix ms
   */
  evict(nowTs: number): void {
    const cutoff = nowTs - this.windowMs;
    // Fast path: if the oldest entry is still within the window, nothing to do
    if (this.items.length === 0 || this.items[0].ts >= cutoff) return;
    // Binary search for the first index that is within the window
    let lo = 0;
    let hi = this.items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.items[mid].ts < cutoff) lo = mid + 1;
      else hi = mid;
    }
    this.items = this.items.slice(lo);
  }

  /**
   * Returns all current items in the window (oldest first).
   * @returns Readonly array of TimedValue<T>
   */
  getItems(): readonly TimedValue<T>[] {
    return this.items;
  }

  /**
   * Returns the most recently pushed item, or undefined if empty.
   * @returns Latest TimedValue<T> or undefined
   */
  getLatest(): TimedValue<T> | undefined {
    return this.items[this.items.length - 1];
  }

  /**
   * Returns the oldest item in the window, or undefined if empty.
   * @returns Oldest TimedValue<T> or undefined
   */
  getOldest(): TimedValue<T> | undefined {
    return this.items[0];
  }

  /**
   * Returns the number of items currently in the window.
   * @returns Item count
   */
  size(): number {
    return this.items.length;
  }

  /**
   * Returns true if the window contains no items.
   * @returns boolean
   */
  isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Returns all raw values (without timestamps) for calculation convenience.
   * @returns Array of T values ordered oldest → newest
   */
  getValues(): T[] {
    return this.items.map((i) => i.value);
  }

  /**
   * Clears all items from the window.
   */
  clear(): void {
    this.items = [];
  }

  /**
   * Returns the configured window duration in milliseconds.
   * @returns Window duration (ms)
   */
  getWindowMs(): number {
    return this.windowMs;
  }
}
