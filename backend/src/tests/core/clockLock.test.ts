/**
 * tests/core/clockLock.test.ts
 *
 * Guards the process-isolation invariant: a simulated clock must never be
 * installed in a process that is running a live or paper trading engine.
 *
 * Regression context — on 10 Sept 2026 a backtest launched from the UI ran
 * inside the paper-trading process. For the duration of that run every nowMs()
 * call in the live path returned simulated Sept-2025 time, including the
 * timestamps stamped on incoming live quotes.
 */

import {
  nowMs,
  setClockOverride,
  lockClockForLive,
  unlockClockForLive,
  isClockLockedForLive,
} from "../../utils/time";

describe("live clock lock", () => {
  afterEach(() => {
    // Order matters: clear the override first, since clearing is always
    // permitted, then drop the lock so the next test starts clean.
    setClockOverride(null);
    unlockClockForLive();
  });

  test("an unlocked process accepts a simulated clock", () => {
    expect(isClockLockedForLive()).toBe(false);

    setClockOverride(() => 1_700_000_000_000);

    expect(nowMs()).toBe(1_700_000_000_000);
  });

  test("locking rejects a simulated clock and leaves the wall clock intact", () => {
    lockClockForLive("paper");

    expect(isClockLockedForLive()).toBe(true);
    expect(() => setClockOverride(() => 1_700_000_000_000)).toThrow(
      /Refusing to install a simulated clock/,
    );

    // The failed call must not have partially applied — nowMs() still reads real time.
    expect(nowMs()).toBeGreaterThan(1_760_000_000_000);
  });

  test("the rejection names the offending mode and points at the fix", () => {
    lockClockForLive("real");

    expect(() => setClockOverride(() => 1)).toThrow(/'real' trading engine/);
    expect(() => setClockOverride(() => 1)).toThrow(/dev:api|dev:backtest/);
  });

  test("clearing the override is always allowed, even while locked", () => {
    // A cleanup path (a finally block in BacktestEngine) must never deadlock.
    lockClockForLive("paper");

    expect(() => setClockOverride(null)).not.toThrow();
  });

  test("lockClockForLive is idempotent", () => {
    lockClockForLive("paper");
    lockClockForLive("paper");

    expect(isClockLockedForLive()).toBe(true);
    expect(() => setClockOverride(() => 1)).toThrow();
  });
});
