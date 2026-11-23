/**
 * bench/fixtures/edgeCaseFixture.ts
 *
 * The small checked-in fixture: a hand-built recording of Alpaca stock-stream
 * frames covering the cases the benchmark must handle correctly before any
 * number it produces can be trusted. It is SYNTHETIC — prices, sizes and
 * timing are invented, not captured from Alpaca.
 *
 * Kept as code (not a data file) so it ships inside the compiled build and
 * runs on a host that only has dist/. EDGE_CASE_EXPECTATIONS states, by hand,
 * what the adapter must report for it; tests and `bench fixture` assert them.
 *
 * Covered (guide §9 fixture list):
 *   - a frame mixing quotes and trades; a frame with bars
 *   - identical provider timestamps at distinct receive positions
 *   - timestamps that differ only after the third fractional digit
 *   - zero sizes, locked / crossed / one-sided / non-positive quotes,
 *     missing fields, an unparseable timestamp, bad trade prices
 *   - out-of-order provider time, a duplicate trade, a correction, a cancel
 *   - a bar, then a fresher quote, then a revision of that bar
 *   - status, LULD, unknown and type-less messages; a non-JSON frame and a
 *     non-array frame
 *   - a disconnect, reconnect and acknowledged resubscription (epoch 2)
 *   - a 200-message batch and a 100-frame burst within 50 ms
 *
 * Inputs:  none.
 * Outputs: RecordingRecord[] in the recorder's format; expectations.
 */

import type { RecordingRecord } from "../../core/telemetry/frameRecorder";

/** Tuesday 2026-03-10 14:30:00 UTC = 10:30 New York (EDT), inside the regular session. */
export const FIXTURE_BASE_WALL_MS = Date.UTC(2026, 2, 10, 14, 30, 0);
const MONO_BASE_NS = 5_000_000_000n;

/** RFC-3339 with nanoseconds: base + ms, plus extra sub-millisecond nanoseconds. */
export function fixtureIso(offsetMs: number, subMsNs = 0): string {
  const whole = Math.floor(offsetMs);
  const iso = new Date(FIXTURE_BASE_WALL_MS + whole).toISOString(); // ...T14:30:00.123Z
  const frac = Math.round((offsetMs - whole) * 1e6) + subMsNs;
  return iso.replace(/\.(\d{3})Z$/, (_m, ms: string) => `.${ms}${String(frac).padStart(6, "0")}Z`);
}

class FixtureBuilder {
  readonly records: RecordingRecord[] = [];
  private seq = 0;
  epoch = 1;

  frame(atMs: number, body: unknown[] | string): void {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    this.records.push({
      v: 1, type: "frame", epoch: this.epoch, seq: ++this.seq,
      rx_wall_ms: FIXTURE_BASE_WALL_MS + Math.floor(atMs),
      rx_mono_ns: (MONO_BASE_NS + BigInt(Math.round(atMs * 1e6))).toString(),
      data: text,
    });
  }

  lifecycle(atMs: number, kind: string, detail?: Record<string, unknown>): void {
    this.records.push({
      v: 1, type: "lifecycle", epoch: this.epoch, kind,
      rx_wall_ms: FIXTURE_BASE_WALL_MS + Math.floor(atMs),
      rx_mono_ns: (MONO_BASE_NS + BigInt(Math.round(atMs * 1e6))).toString(),
      ...(detail ? { detail } : {}),
    });
  }
}

const quote = (sym: string, tMs: number, bp: number, ap: number, bs = 3, as = 2, subNs = 0): Record<string, unknown> => ({
  T: "q", S: sym, bx: "V", bp, bs, ax: "V", ap, as, c: ["R"], z: sym === "QQQ" ? "C" : "B", t: fixtureIso(tMs, subNs),
});
const trade = (sym: string, tMs: number, p: unknown, s: unknown, i: number, subNs = 0): Record<string, unknown> => ({
  T: "t", S: sym, i, x: "V", p, s, c: ["@"], z: sym === "QQQ" ? "C" : "B", t: fixtureIso(tMs, subNs),
});
const bar = (sym: string, startOffsetMs: number, o: number, h: number, l: number, c: number, v: number): Record<string, unknown> => ({
  T: "b", S: sym, o, h, l, c, v, vw: (h + l) / 2, n: 12, t: new Date(FIXTURE_BASE_WALL_MS + startOffsetMs).toISOString().replace(".000Z", "Z"),
});
const SUBSCRIPTION_ACK = {
  T: "subscription", trades: ["SPY", "QQQ"], quotes: ["SPY", "QQQ"], bars: ["SPY", "QQQ"],
  updatedBars: [], dailyBars: [], statuses: [], lulds: [], corrections: ["SPY", "QQQ"], cancelErrors: ["SPY", "QQQ"],
};

/** Builds the fixture recording. Deterministic: same records every call. */
export function buildEdgeCaseFixture(): RecordingRecord[] {
  const b = new FixtureBuilder();

  // --- Epoch 1: connect, authenticate, subscribe -------------------------
  b.lifecycle(0, "connecting");
  b.lifecycle(0, "open");
  b.frame(0, [{ T: "success", msg: "connected" }]);
  b.frame(2, [{ T: "success", msg: "authenticated" }]);
  b.lifecycle(2, "authenticated");
  b.frame(5, [SUBSCRIPTION_ACK]);

  // Mixed batch; the SPY quote is bid-heavy (imbalance 0.85) so a quote strategy can act.
  b.frame(100, [
    quote("SPY", 97, 500.0, 500.02, 12, 1),
    trade("SPY", 98, 500.01, 100, 1001),
    quote("QQQ", 98, 430.0, 430.02, 2, 2),
    trade("QQQ", 99, 430.01, 50, 2001),
  ]);
  // Identical provider timestamps, distinct receive positions (index 0 and 1, then another frame).
  b.frame(150, [quote("SPY", 148, 500.0, 500.02, 3, 3), quote("SPY", 148, 500.01, 500.03, 3, 3)]);
  b.frame(151, [quote("SPY", 148, 500.01, 500.03, 4, 3)]);
  // Differ only after the third fractional digit: .199123456 vs .199123999.
  b.frame(200, [trade("SPY", 199, 500.02, 10, 1002, 123_456), trade("SPY", 199, 500.02, 10, 1003, 123_999)]);
  // Quotes that must be flagged or rejected.
  b.frame(250, [
    quote("SPY", 249, 500.0, 500.02, 0, 3),   // ZERO_SIZE (flag)
    quote("SPY", 249, 500.01, 500.01),        // LOCKED_QUOTE (flag)
    quote("SPY", 249, 500.05, 500.0),         // CROSSED_QUOTE (reject)
    quote("SPY", 249, 500.0, 0),              // ONE_SIDED_QUOTE (reject) — IEX sends these
    quote("SPY", 249, -1, -1),                // NON_POSITIVE_PRICE (reject)
    { T: "q", S: "SPY", bp: 500.0, bs: 1, as: 1, t: fixtureIso(249) }, // MISSING_FIELD (reject)
    { ...quote("SPY", 249, 500.0, 500.02), t: "not-a-time" },        // BAD_TIMESTAMP (reject)
  ]);
  // Trades that must be flagged or rejected.
  b.frame(300, [
    trade("SPY", 299, 0, 10, 1004),           // NON_POSITIVE_PRICE (reject)
    trade("SPY", 299, 500.02, 0, 1005),       // ZERO_SIZE (flag)
    trade("SPY", 299, "abc", 10, 1006),       // NON_FINITE_PRICE (reject)
  ]);
  // Provider time earlier than events already delivered.
  b.frame(350, [trade("QQQ", 90, 430.0, 5, 2002)]);
  // Exact duplicate of the first SPY trade.
  b.frame(351, [trade("SPY", 98, 500.01, 100, 1001)]);
  // A correction and a cancel/error (subscribed automatically with trades; not handled downstream).
  b.frame(400, [
    { T: "c", S: "SPY", x: "V", oi: 1002, op: 500.02, os: 10, oc: ["@"], ci: 1007, cp: 500.03, cs: 10, cc: ["@"], z: "B", t: fixtureIso(399) },
    { T: "x", S: "SPY", i: 1003, x: "V", p: 500.02, s: 10, a: "C", z: "B", t: fixtureIso(399) },
  ]);

  // The 14:30 minute bar arrives 50 ms after its interval ends; then a fresher quote; then its revision.
  b.frame(60_050, [bar("SPY", 0, 500.0, 500.1, 499.9, 500.05, 1_000), bar("QQQ", 0, 430.0, 430.1, 429.9, 430.02, 800)]);
  b.frame(60_060, [quote("SPY", 60_058, 500.06, 500.08, 2, 2)]);
  b.frame(90_010, [{ ...bar("SPY", 0, 500.0, 500.1, 499.9, 500.06, 1_010), T: "u" }]);

  // Messages the adapter does not consume.
  b.frame(90_020, [
    { T: "s", S: "SPY", sc: "T", sm: "Trading", rc: "", rm: "", z: "B", t: fixtureIso(90_019) },
    { T: "l", S: "SPY", u: 525.0, d: 475.0, i: "A", z: "B", t: fixtureIso(90_019) },
    { T: "zz", S: "SPY" },
    {},
  ]);
  b.frame(90_030, "not json");
  b.frame(90_031, JSON.stringify({ T: "q", S: "SPY" }));

  // --- Disconnect, reconnect, resubscribe (epoch 2) ----------------------
  b.lifecycle(90_100, "closed");
  b.lifecycle(90_100, "reconnect_scheduled", { delayMs: 5_000 });
  b.epoch = 2;
  b.lifecycle(95_100, "connecting");
  b.lifecycle(95_105, "open");
  b.frame(95_110, [{ T: "success", msg: "connected" }]);
  b.frame(95_112, [{ T: "success", msg: "authenticated" }]);
  b.lifecycle(95_112, "authenticated");
  b.lifecycle(95_112, "subscribe_sent", { symbols: ["SPY", "QQQ"], restored: true });
  b.frame(95_120, [SUBSCRIPTION_ACK]);

  // A 200-message batch.
  const batch: unknown[] = [];
  for (let i = 0; i < 200; i++) {
    const sym = i % 2 === 0 ? "SPY" : "QQQ";
    const px = sym === "SPY" ? 500 + (i % 7) * 0.01 : 430 + (i % 5) * 0.01;
    batch.push(quote(sym, 95_990, px, px + 0.02, 1 + (i % 4), 1 + ((i + 1) % 4), i));
  }
  b.frame(96_000, batch);

  // A burst: 100 frames in 50 ms, each with one quote and one trade.
  for (let i = 0; i < 100; i++) {
    const at = 97_000 + i * 0.5;
    const px = 500 + (i % 10) * 0.01;
    b.frame(at, [quote("SPY", at - 1, px, px + 0.02, 5, 1 + (i % 6)), trade("SPY", at - 1, px + 0.01, 10, 3000 + i)]);
  }
  return b.records;
}

/** What the adapter must report for the fixture (stated by hand, not computed). */
export const EDGE_CASE_EXPECTATIONS = {
  frames: 122,
  lifecycleRecords: 9,
  epochs: [1, 2],
  parseFailures: 2,
  events: { quote: 313, trade: 109, bar: 2 },
  issues: {
    quote: { ZERO_SIZE: 1, LOCKED_QUOTE: 1, CROSSED_QUOTE: 1, ONE_SIDED_QUOTE: 1, NON_POSITIVE_PRICE: 1, MISSING_FIELD: 1, BAD_TIMESTAMP: 1 },
    trade: { NON_POSITIVE_PRICE: 1, ZERO_SIZE: 1, NON_FINITE_PRICE: 1 },
  },
  /** Dropped under invalidData="quarantine" ("reject"-severity issues only). */
  quarantined: { quote: 5, trade: 2 },
  unhandled: { s: 1, l: 1, zz: 1, missing_T: 1 },
  /** Corrections of data already delivered: published, state-only. */
  revisions: { bar_revised: 1, trade_corrected: 1, trade_canceled: 1 },
  subscriptionAcks: 2,
  /** Bar publication lag: received 50 ms after the interval end. */
  barPublicationLagMs: 50,
} as const;
