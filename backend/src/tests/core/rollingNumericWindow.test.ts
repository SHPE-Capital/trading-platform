/**
 * tests/core/rollingNumericWindow.test.ts
 *
 * RollingNumericWindow maintains mean and standard deviation incrementally so
 * the pairs strategy does not copy and rescan its whole spread window on every
 * bar. These tests pin it to the same answers as the naive O(n) helpers.
 */

import { RollingNumericWindow } from "../../core/state/rollingWindow";
import { computeMean, computeStdDev } from "../../services/indicators/zscore";

/** Pushes values on a 1-minute cadence starting at an arbitrary epoch. */
function fill(win: RollingNumericWindow, values: number[], startTs = 1_700_000_000_000): void {
  values.forEach((value, i) => win.push({ ts: startTs + i * 60_000, value }));
}

describe("RollingNumericWindow", () => {
  const HOUR = 3_600_000;

  it("returns null stats until there are enough observations", () => {
    const win = new RollingNumericWindow(HOUR);
    expect(win.mean()).toBeNull();
    expect(win.stdDev()).toBeNull();

    fill(win, [10]);
    expect(win.mean()).toBe(10);
    expect(win.stdDev()).toBeNull(); // sample stddev needs n >= 2
  });

  it("matches the naive mean and sample stddev", () => {
    const values = [12, 15, 11, 18, 14, 13, 16, 19, 10, 17];
    const win = new RollingNumericWindow(HOUR);
    fill(win, values);

    const expectedMean = computeMean(values);
    expect(win.mean()).toBeCloseTo(expectedMean, 12);
    expect(win.stdDev()).toBeCloseTo(computeStdDev(values, expectedMean), 12);
  });

  it("subtracts evicted values so stats reflect only the live window", () => {
    // Window holds 5 minutes; push 10 one-minute values so the first half ages out.
    const win = new RollingNumericWindow(5 * 60_000);
    fill(win, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const retained = win.getValues();
    expect(retained.length).toBeLessThan(10);

    const expectedMean = computeMean(retained);
    expect(win.mean()).toBeCloseTo(expectedMean, 12);
    expect(win.stdDev()).toBeCloseTo(computeStdDev(retained, expectedMean), 12);
  });

  it("stays accurate for large values with a small spread", () => {
    // The precision-sensitive case: a pairs spread near -80 varying by cents.
    // Naive sum-of-squares subtracts two nearly equal large numbers here.
    const values = Array.from({ length: 500 }, (_, i) => -80 + Math.sin(i) * 0.35);
    const win = new RollingNumericWindow(HOUR * 24);
    fill(win, values);

    const retained = win.getValues();
    const expectedMean = computeMean(retained);
    expect(win.mean()).toBeCloseTo(expectedMean, 9);
    expect(win.stdDev()).toBeCloseTo(computeStdDev(retained, expectedMean), 9);
  });

  it("stays accurate across a periodic rebuild", () => {
    // More than REBUILD_INTERVAL (4096) pushes, so the exact recompute fires.
    const win = new RollingNumericWindow(HOUR * 24 * 365);
    const values = Array.from({ length: 5_000 }, (_, i) => 100 + ((i * 37) % 19) * 0.25);
    fill(win, values);

    const retained = win.getValues();
    const expectedMean = computeMean(retained);
    expect(win.mean()).toBeCloseTo(expectedMean, 9);
    expect(win.stdDev()).toBeCloseTo(computeStdDev(retained, expectedMean), 9);
  });

  it("reports zero deviation for a constant series", () => {
    const win = new RollingNumericWindow(HOUR);
    fill(win, [42, 42, 42, 42]);
    expect(win.mean()).toBe(42);
    // Must never go negative through rounding.
    expect(win.stdDev()).toBeGreaterThanOrEqual(0);
    expect(win.stdDev()).toBeCloseTo(0, 12);
  });

  it("resets its accumulators on clear()", () => {
    const win = new RollingNumericWindow(HOUR);
    fill(win, [5, 10, 15]);
    win.clear();
    expect(win.mean()).toBeNull();

    fill(win, [1, 3]);
    expect(win.mean()).toBeCloseTo(2, 12);
  });
});
