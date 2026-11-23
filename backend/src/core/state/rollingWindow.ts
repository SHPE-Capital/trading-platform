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
 * - A plain array with a head index: eviction advances the head, and the
 *   evicted prefix is dropped in bulk once it is at least half the array, so
 *   each item is copied O(1) times on average instead of the whole window
 *   being copied on every evicting push.
 * - Eviction happens on every push.
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

/** Dead prefix length below which compaction is not worth a copy. */
const COMPACT_MIN = 32;

export class RollingTimeWindow<T> {
  /** Backing store. Live items are items[head..]; read them through the accessors. */
  protected items: TimedValue<T>[] = [];
  /** Index of the oldest live item in `items`. */
  protected head = 0;

  /**
   * Creates a new rolling time window.
   * @param windowMs - Duration of the window in milliseconds.
   *                   Entries older than this from the most recent push are evicted.
   */
  constructor(private readonly windowMs: number) {}

  /**
   * Adds a timestamped value and evicts entries older than the window,
   * measured from the NEWEST timestamp held.
   *
   * Items are kept in time order: a late item (older than the newest — an
   * out-of-order print) is inserted at its place rather than appended, so
   * eviction's binary search stays correct and a late item cannot drag "now"
   * backwards. Late items cost an O(n) insert; in-order pushes stay O(1).
   * An item whose timestamp is not a finite number is ignored: it cannot be
   * placed in time.
   * @param item - A TimedValue containing the timestamp and value
   */
  push(item: TimedValue<T>): void {
    if (!Number.isFinite(item.ts)) return;
    const items = this.items;
    const n = items.length;
    if (n === this.head || item.ts >= items[n - 1].ts) {
      items.push(item);
      this.evict(item.ts);
      return;
    }
    // Insert after any items with the same timestamp, keeping arrival order among equals.
    let lo = this.head;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (items[mid].ts <= item.ts) lo = mid + 1;
      else hi = mid;
    }
    items.splice(lo, 0, item);
    this.evict(items[items.length - 1].ts);
  }

  /**
   * Removes all entries whose timestamp is older than (nowTs - windowMs).
   * Should be called after every push.
   * @param nowTs - The reference "current" time in Unix ms
   */
  evict(nowTs: number): void {
    const cutoff = nowTs - this.windowMs;
    const items = this.items;
    // Fast path: if the oldest entry is still within the window, nothing to do
    if (this.head >= items.length || items[this.head].ts >= cutoff) return;
    // Binary search for the first index that is within the window
    let lo = this.head;
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (items[mid].ts < cutoff) lo = mid + 1;
      else hi = mid;
    }
    this.head = lo;
    if (lo === items.length) {
      this.items = [];
      this.head = 0;
    } else if (lo >= COMPACT_MIN && lo * 2 >= items.length) {
      this._compact();
    }
  }

  /**
   * Returns all current items in the window (oldest first).
   * @returns Readonly array of TimedValue<T>
   */
  getItems(): readonly TimedValue<T>[] {
    this._compact();
    return this.items;
  }

  /**
   * Returns the newest item by timestamp (the last pushed, unless it arrived
   * late), or undefined if empty.
   * @returns Latest TimedValue<T> or undefined
   */
  getLatest(): TimedValue<T> | undefined {
    return this.head < this.items.length ? this.items[this.items.length - 1] : undefined;
  }

  /**
   * Returns the oldest item in the window, or undefined if empty.
   * @returns Oldest TimedValue<T> or undefined
   */
  getOldest(): TimedValue<T> | undefined {
    return this.items[this.head];
  }

  /**
   * Returns the number of items currently in the window.
   * @returns Item count
   */
  size(): number {
    return this.items.length - this.head;
  }

  /**
   * Returns true if the window contains no items.
   * @returns boolean
   */
  isEmpty(): boolean {
    return this.items.length === this.head;
  }

  /**
   * Returns all raw values (without timestamps) for calculation convenience.
   * @returns Array of T values ordered oldest → newest
   */
  getValues(): T[] {
    const n = this.items.length - this.head;
    const out = new Array<T>(n);
    for (let i = 0; i < n; i++) out[i] = this.items[this.head + i].value;
    return out;
  }

  /**
   * Clears all items from the window.
   */
  clear(): void {
    this.items = [];
    this.head = 0;
  }

  /**
   * Returns the configured window duration in milliseconds.
   * @returns Window duration (ms)
   */
  getWindowMs(): number {
    return this.windowMs;
  }

  /** Drops the evicted prefix from the backing store. */
  protected _compact(): void {
    if (this.head === 0) return;
    this.items = this.items.slice(this.head);
    this.head = 0;
  }
}

/**
 * A rolling window of numbers that maintains its own running sum and sum of
 * squares, so mean and standard deviation are O(1) instead of O(n).
 *
 * The generic RollingTimeWindow requires callers to pull the whole window out
 * with getValues() — which allocates a fresh array — and scan it. For the pairs
 * spread window that happens once per bar, so a year of minute bars over a
 * multi-day window costs hundreds of millions of operations and just as many
 * short-lived allocations. Tracking the two accumulators incrementally removes
 * both: each value is added once when it arrives and subtracted once when it
 * ages out.
 *
 * Numerical note: computing variance from a running sum of squares can lose
 * precision when the values are large relative to their spread — exactly the
 * pairs case, where a spread near -80 may vary by less than a dollar. To bound
 * that drift the accumulators are recomputed exactly from the retained items
 * every REBUILD_INTERVAL pushes, which keeps the amortised cost O(1) while
 * capping accumulated floating-point error.
 */
export class RollingNumericWindow extends RollingTimeWindow<number> {
  private _sum = 0;
  private _sumSq = 0;
  private _pushesSinceRebuild = 0;

  /** Pushes between exact recomputations of the accumulators. */
  private static readonly REBUILD_INTERVAL = 4096;

  override push(item: TimedValue<number>): void {
    if (!Number.isFinite(item.ts)) return; // ignored by the base class too; keep the sums consistent
    this._sum += item.value;
    this._sumSq += item.value * item.value;
    // super.push appends then calls this.evict, which subtracts anything aged out.
    super.push(item);

    if (++this._pushesSinceRebuild >= RollingNumericWindow.REBUILD_INTERVAL) {
      this._rebuild();
    }
  }

  override evict(nowTs: number): void {
    const cutoff = nowTs - this.getWindowMs();
    // Count the expiring prefix and remove its contribution. Amortised O(1):
    // every item is visited here exactly once, on its way out.
    let i = this.head;
    while (i < this.items.length && this.items[i].ts < cutoff) {
      const v = this.items[i].value;
      this._sum -= v;
      this._sumSq -= v * v;
      i++;
    }
    super.evict(nowTs);
  }

  override clear(): void {
    super.clear();
    this._sum = 0;
    this._sumSq = 0;
    this._pushesSinceRebuild = 0;
  }

  /** Arithmetic mean of the window, or null when empty. */
  mean(): number | null {
    const n = this.size();
    if (n === 0) return null;
    return this._sum / n;
  }

  /**
   * Sample standard deviation (n-1 denominator), matching computeStdDev.
   * Returns null when fewer than 2 observations are present.
   */
  stdDev(): number | null {
    const n = this.size();
    if (n < 2) return null;
    const mean = this._sum / n;
    // Clamp: rounding can push a zero-variance window marginally negative.
    const variance = Math.max(0, (this._sumSq - n * mean * mean) / (n - 1));
    return Math.sqrt(variance);
  }

  /** Recomputes the accumulators exactly from the retained items. */
  private _rebuild(): void {
    let sum = 0;
    let sumSq = 0;
    for (let i = this.head; i < this.items.length; i++) {
      const v = this.items[i].value;
      sum += v;
      sumSq += v * v;
    }
    this._sum = sum;
    this._sumSq = sumSq;
    this._pushesSinceRebuild = 0;
  }
}
