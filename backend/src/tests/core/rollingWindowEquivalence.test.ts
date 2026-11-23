/**
 * tests/core/rollingWindowEquivalence.test.ts
 *
 * Audit finding 5: RollingTimeWindow.evict copied the whole window (slice) on
 * every evicting push. It now advances a head index and compacts in bulk.
 * This property test runs random in-order operation sequences — including
 * duplicate timestamps and external evict() calls — against a verbatim
 * copy of the previous implementation and requires identical observable
 * results, bit for bit for RollingNumericWindow's mean and stdDev (the pairs
 * strategy's z-score depends on them).
 */

import { RollingTimeWindow, RollingNumericWindow, type TimedValue } from "../../core/state/rollingWindow";
import { seededRandom } from "../../bench/random";

/** The implementation before the head index (copied, including the NaN guard). */
class ReferenceWindow<T> {
  items: TimedValue<T>[] = [];
  constructor(readonly windowMs: number) {}
  push(item: TimedValue<T>): void {
    if (!Number.isFinite(item.ts)) return;
    this.items.push(item);
    this.evict(item.ts);
  }
  evict(nowTs: number): void {
    const cutoff = nowTs - this.windowMs;
    if (this.items.length === 0 || this.items[0].ts >= cutoff) return;
    let lo = 0;
    let hi = this.items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.items[mid].ts < cutoff) lo = mid + 1;
      else hi = mid;
    }
    this.items = this.items.slice(lo);
  }
}

class ReferenceNumericWindow extends ReferenceWindow<number> {
  sum = 0;
  sumSq = 0;
  sinceRebuild = 0;
  override push(item: TimedValue<number>): void {
    if (!Number.isFinite(item.ts)) return;
    this.sum += item.value;
    this.sumSq += item.value * item.value;
    super.push(item);
    if (++this.sinceRebuild >= 4096) {
      let s = 0, q = 0;
      for (const it of this.items) { s += it.value; q += it.value * it.value; }
      this.sum = s; this.sumSq = q; this.sinceRebuild = 0;
    }
  }
  override evict(nowTs: number): void {
    const cutoff = nowTs - this.windowMs;
    let removed = 0;
    while (removed < this.items.length && this.items[removed].ts < cutoff) {
      const v = this.items[removed].value;
      this.sum -= v;
      this.sumSq -= v * v;
      removed++;
    }
    super.evict(nowTs);
  }
  mean(): number | null {
    const n = this.items.length;
    return n === 0 ? null : this.sum / n;
  }
  stdDev(): number | null {
    const n = this.items.length;
    if (n < 2) return null;
    const mean = this.sum / n;
    return Math.sqrt(Math.max(0, (this.sumSq - n * mean * mean) / (n - 1)));
  }
}

function runSequence(seed: number, windowMs: number, ops: number): void {
  const rand = seededRandom(seed);
  const w = new RollingNumericWindow(windowMs);
  const ref = new ReferenceNumericWindow(windowMs);
  let t = 0;
  for (let i = 0; i < ops; i++) {
    const r = rand();
    if (r < 0.85) {
      // Forward in time, sometimes equal. Late (out-of-order) items are covered
      // separately below: the window now keeps them in time order.
      const step = rand() < 0.2 ? 0 : Math.floor(rand() * windowMs * 0.2);
      t += step;
      const item = { ts: t, value: 100 + rand() * 10 - 5 };
      w.push(item);
      ref.push(item);
    } else if (r < 0.95) {
      const now = t + Math.floor((rand() - 0.3) * windowMs * 2);
      w.evict(now);
      ref.evict(now);
    } else if (r < 0.96) {
      w.clear();
      ref.items = []; ref.sum = 0; ref.sumSq = 0; ref.sinceRebuild = 0;
    } else {
      expect(w.getItems()).toEqual(ref.items);
    }
    expect(w.size()).toBe(ref.items.length);
    expect(w.isEmpty()).toBe(ref.items.length === 0);
    expect(w.getOldest()).toBe(ref.items[0]);
    expect(w.getLatest()).toBe(ref.items[ref.items.length - 1]);
    expect(Object.is(w.mean(), ref.mean())).toBe(true);
    expect(Object.is(w.stdDev(), ref.stdDev())).toBe(true);
  }
  expect(w.getValues()).toEqual(ref.items.map((x) => x.value));
}

describe("RollingTimeWindow head-index eviction matches the previous implementation", () => {
  it.each([
    [1, 1_000, 5_000],
    [2, 60_000, 5_000],
    [3, 50, 5_000],
    [4, 10_000, 12_000], // crosses the 4,096-push accumulator rebuild
  ])("seed %i, window %i ms, %i operations", (seed, windowMs, ops) => {
    runSequence(seed, windowMs, ops);
  });

  it("generic windows return the same values and items", () => {
    const rand = seededRandom(9);
    const w = new RollingTimeWindow<string>(500);
    const ref = new ReferenceWindow<string>(500);
    let t = 0;
    for (let i = 0; i < 3_000; i++) {
      t += Math.floor(rand() * 40);
      const item = { ts: t, value: `v${i}` };
      w.push(item);
      ref.push(item);
      if (i % 97 === 0) expect(w.getItems()).toEqual(ref.items);
    }
    expect(w.getValues()).toEqual(ref.items.map((x) => x.value));
  });

  it("keeps the backing store bounded while the window slides", () => {
    const w = new RollingTimeWindow<number>(100);
    for (let t = 0; t < 100_000; t++) w.push({ ts: t, value: t });
    expect(w.size()).toBe(101);
    // Live items plus at most a compaction's worth of evicted prefix.
    expect((w as unknown as { items: unknown[] }).items.length).toBeLessThanOrEqual(2 * 101 + 32);
  });
});

describe("late (out-of-order) items", () => {
  it("are kept in time order and evicted from the newest timestamp, like a brute-force model", () => {
    const rand = seededRandom(31);
    const windowMs = 1_000;
    const w = new RollingNumericWindow(windowMs);
    const all: Array<{ ts: number; value: number; seq: number }> = [];
    let t = 10_000;
    for (let i = 0; i < 4_000; i++) {
      t += Math.floor(rand() * 60);
      const ts = rand() < 0.15 ? t - Math.floor(rand() * 1_500) : t; // some arrive late, some too late to keep
      const item = { ts, value: Math.round(rand() * 1_000) / 10, seq: i };
      all.push(item);
      w.push({ ts: item.ts, value: item.value });
      const newest = Math.max(...all.map((x) => x.ts));
      const expected = all
        .filter((x) => x.ts >= newest - windowMs)
        .sort((a, b) => a.ts - b.ts || a.seq - b.seq);
      if (i % 50 === 0 || i > 3_990) {
        expect(w.getItems().map((x) => x.ts)).toEqual(expected.map((x) => x.ts));
        expect(w.getValues()).toEqual(expected.map((x) => x.value));
        const mean = expected.reduce((a, x) => a + x.value, 0) / expected.length;
        expect(w.mean()!).toBeCloseTo(mean, 6);
        expect(w.getLatest()!.ts).toBe(newest);
      }
    }
  });
});
