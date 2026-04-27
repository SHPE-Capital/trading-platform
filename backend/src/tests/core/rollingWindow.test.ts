import { RollingTimeWindow } from '../../core/state/rollingWindow';

describe('RollingTimeWindow', () => {
  describe('construction and basic push', () => {
    it('starts empty', () => {
      const w = new RollingTimeWindow<number>(1000);
      expect(w.size()).toBe(0);
      expect(w.isEmpty()).toBe(true);
    });

    it('getWindowMs returns constructor arg', () => {
      const w = new RollingTimeWindow<number>(5000);
      expect(w.getWindowMs()).toBe(5000);
    });

    it('after one push: size 1, not empty', () => {
      const w = new RollingTimeWindow<number>(1000);
      w.push({ ts: 100, value: 42 });
      expect(w.size()).toBe(1);
      expect(w.isEmpty()).toBe(false);
    });

    it('getLatest returns the most recently pushed item', () => {
      const w = new RollingTimeWindow<number>(1000);
      w.push({ ts: 100, value: 1 });
      w.push({ ts: 200, value: 2 });
      w.push({ ts: 300, value: 3 });
      expect(w.getLatest()).toEqual({ ts: 300, value: 3 });
    });

    it('getOldest returns the earliest item', () => {
      const w = new RollingTimeWindow<number>(1000);
      w.push({ ts: 100, value: 10 });
      w.push({ ts: 200, value: 20 });
      expect(w.getOldest()).toEqual({ ts: 100, value: 10 });
    });

    it('getValues returns raw values oldest-first', () => {
      const w = new RollingTimeWindow<number>(10000);
      w.push({ ts: 1, value: 'a' as unknown as number });
      w.push({ ts: 2, value: 'b' as unknown as number });
      w.push({ ts: 3, value: 'c' as unknown as number });
      expect(w.getValues()).toEqual(['a', 'b', 'c']);
    });

    it('clear resets to empty', () => {
      const w = new RollingTimeWindow<number>(1000);
      w.push({ ts: 1, value: 99 });
      w.push({ ts: 2, value: 88 });
      w.clear();
      expect(w.size()).toBe(0);
      expect(w.isEmpty()).toBe(true);
      expect(w.getLatest()).toBeUndefined();
      expect(w.getOldest()).toBeUndefined();
    });
  });

  describe('eviction correctness', () => {
    it('evicts items older than windowMs from the latest push', () => {
      const w = new RollingTimeWindow<number>(1000);
      w.push({ ts: 0, value: 0 });
      w.push({ ts: 500, value: 500 });
      // cutoff after ts=1001: 1001-1000=1, so ts=0 evicted
      w.push({ ts: 1001, value: 1001 });
      const values = w.getValues();
      expect(values).not.toContain(0);
      expect(values).toContain(500);
      expect(values).toContain(1001);
    });

    it('item exactly at cutoff (ts === nowTs - windowMs) is retained', () => {
      const w = new RollingTimeWindow<number>(1000);
      w.push({ ts: 0, value: 0 });
      w.push({ ts: 500, value: 500 });
      w.push({ ts: 999, value: 999 });
      // cutoff = 1000 - 1000 = 0, items with ts < 0 evicted → ts=0 survives
      w.push({ ts: 1000, value: 1000 });
      expect(w.getValues()).toContain(0);

      // cutoff = 1001 - 1000 = 1, ts=0 now evicted
      w.push({ ts: 1001, value: 1001 });
      expect(w.getValues()).not.toContain(0);
      expect(w.getValues()).toContain(500); // ts=500 >= 1, retained
    });

    it('pushing into an empty window does not throw', () => {
      const w = new RollingTimeWindow<number>(1000);
      expect(() => w.push({ ts: 100, value: 42 })).not.toThrow();
    });

    it('after eviction, getOldest is the first surviving item', () => {
      const w = new RollingTimeWindow<number>(500);
      w.push({ ts: 0, value: 0 });
      w.push({ ts: 100, value: 100 });
      w.push({ ts: 400, value: 400 });
      // Push ts=600: cutoff=100; ts=0 evicted (0 < 100), ts=100 retained (100 >= 100)
      w.push({ ts: 600, value: 600 });
      expect(w.getOldest()).toEqual({ ts: 100, value: 100 });
    });

    it('all items evicted when every entry is older than the window', () => {
      const w = new RollingTimeWindow<number>(100);
      w.push({ ts: 0, value: 0 });
      w.push({ ts: 10, value: 10 });
      w.push({ ts: 20, value: 20 });
      // Push ts=200: cutoff=100; all prior ts < 100 → all evicted
      // Only the new item ts=200 survives after the push (it was just added, then evict runs)
      // Actually: push adds ts=200, then evict(200): cutoff=100, evict ts<100 (0,10,20 evicted)
      // ts=200 was just added, so it survives
      w.push({ ts: 200, value: 200 });
      expect(w.size()).toBe(1);
      expect(w.getOldest()).toEqual({ ts: 200, value: 200 });
    });
  });

  describe('binary search eviction at scale', () => {
    it('correctly retains 501 items after 1000-item push into windowMs=500', () => {
      const w = new RollingTimeWindow<number>(500);
      for (let i = 0; i < 1000; i++) {
        w.push({ ts: i, value: i });
      }
      // Final push ts=999: cutoff = 999-500 = 499
      // Items with ts < 499 evicted; ts 499..999 retained = 501 items
      expect(w.size()).toBe(501);
      expect(w.getOldest()?.ts).toBe(499);
      expect(w.getLatest()?.ts).toBe(999);
    });

    it('only the last item survives with large timestamp gaps', () => {
      const w = new RollingTimeWindow<number>(5000);
      w.push({ ts: 0, value: 0 });
      w.push({ ts: 10_000, value: 10_000 });
      // cutoff = 10000-5000 = 5000; ts=0 < 5000 → evicted
      expect(w.size()).toBe(1);
      expect(w.getOldest()?.ts).toBe(10_000);

      w.push({ ts: 20_000, value: 20_000 });
      // cutoff = 20000-5000 = 15000; ts=10000 < 15000 → evicted
      expect(w.size()).toBe(1);
      expect(w.getOldest()?.ts).toBe(20_000);
    });

    it('getValues returns items in ascending timestamp order after partial eviction', () => {
      const w = new RollingTimeWindow<number>(500);
      for (let i = 0; i < 100; i++) {
        w.push({ ts: i * 10, value: i });
      }
      const values = w.getValues();
      const items = w.getItems();
      for (let i = 1; i < items.length; i++) {
        expect(items[i].ts).toBeGreaterThanOrEqual(items[i - 1].ts);
      }
      expect(values.length).toBe(w.size());
    });
  });

  describe('getValues() contract', () => {
    it('returns empty array when window is empty', () => {
      const w = new RollingTimeWindow<number>(1000);
      expect(w.getValues()).toEqual([]);
    });

    it('length equals size()', () => {
      const w = new RollingTimeWindow<number>(10000);
      w.push({ ts: 1, value: 1 });
      w.push({ ts: 2, value: 2 });
      w.push({ ts: 3, value: 3 });
      expect(w.getValues().length).toBe(w.size());
    });

    it('mutating returned array does not affect internal state', () => {
      const w = new RollingTimeWindow<number>(10000);
      w.push({ ts: 1, value: 1 });
      w.push({ ts: 2, value: 2 });

      const snapshot = w.getValues();
      const originalLength = snapshot.length;

      // Mutate the returned array
      (snapshot as number[]).push(99);

      // Push a new real item
      w.push({ ts: 3, value: 3 });

      // Original snapshot is unaffected by the new push
      expect(snapshot.length).toBe(originalLength + 1); // we pushed 99 into it
      // Internal window now has 3 items, not 4
      expect(w.size()).toBe(3);
    });
  });
});
