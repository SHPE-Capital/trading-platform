/**
 * tests/core/fastTimestamps.test.ts
 *
 * The normalizer converts every provider timestamp to Unix ms. It used
 * `new Date(iso).getTime()`; rfc3339ToEpochMs must return exactly the same
 * number (including NaN) for any input, only faster. Market-data events get
 * cheap process-unique ids instead of UUIDs.
 */

import { rfc3339ToEpochMs } from "../../core/telemetry/clock";
import { newEventId } from "../../utils/ids";
import { seededRandom } from "../../bench/random";

const same = (iso: string): void => {
  expect(Object.is(rfc3339ToEpochMs(iso), new Date(iso).getTime())).toBe(true);
};

describe("rfc3339ToEpochMs", () => {
  it("equals Date for random UTC timestamps with 0–12 fractional digits", () => {
    const rand = seededRandom(23);
    for (let i = 0; i < 20_000; i++) {
      const base = new Date(Date.UTC(2015, 0, 1) + Math.floor(rand() * 4e11)).toISOString().slice(0, 19);
      const digits = Math.floor(rand() * 13);
      const frac = digits === 0 ? "" : "." + Array.from({ length: digits }, () => Math.floor(rand() * 10)).join("");
      same(`${base}${frac}Z`);
      if (rand() < 0.3) same(`${base}${frac}Z`); // cached-prefix path
    }
  });

  it.each([
    "", "garbage", "2026-03-10T14:30:00", "2026-03-10T14:30:00.Z", "2026-03-10T14:30:60Z",
    "2026-02-30T14:30:00Z", "2026-13-10T14:30:00Z", "2026-03-10T14:30:00.12a4Z", "2026-03-10 14:30:00Z",
    "2026-03-10T09:30:00.5-05:00", "2026-03-10T14:30:00.123456z", "2026-03-10T24:00:00Z",
  ])("equals Date for edge input %p", (iso) => {
    same(iso);
    same("2026-03-10T14:30:00.000Z"); // reset the cache between edge cases
    same(iso);
  });
});

describe("newEventId", () => {
  it("is unique within the process and cheap-looking", () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => newEventId()));
    expect(ids.size).toBe(10_000);
    expect([...ids][0]).toMatch(/^ev-[0-9a-f]{8}-\d+$/);
  });
});
