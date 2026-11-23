/**
 * tests/verify/barArrival.test.ts
 *
 * The bar arrival recorder's statistics on a fake feed: latency percentiles,
 * fraction later than the deadline, missing bars, corrections, server errors.
 */

import { BarArrivalRecorder, barRowsCsv, parseArgs, percentiles } from "../../runtime/verify/barArrival";

const T0 = Date.parse("2026-11-16T15:00:00.000Z"); // a minute start
const MIN = 60_000;
const iso = (i: number) => new Date(T0 + i * MIN).toISOString();
const bar = (symbol: string, minute: number, type = "b") => ({ T: type, S: symbol, t: iso(minute), o: 1, h: 1, l: 1, c: 1, v: 1 });
/** Delivers a bar for `minute` `lagMs` after that minute ends. */
const arrive = (r: BarArrivalRecorder, symbol: string, minute: number, lagMs: number, type = "b") =>
  r.onFrame(JSON.stringify([bar(symbol, minute, type)]), T0 + (minute + 1) * MIN + lagMs);

describe("percentiles", () => {
  it("uses nearest rank and returns null when empty", () => {
    expect(percentiles([])).toBeNull();
    const p = percentiles(Array.from({ length: 100 }, (_, i) => i + 1))!;
    expect(p).toEqual({ p50: 50, p90: 90, p95: 95, p99: 99, max: 100 });
  });
});

describe("BarArrivalRecorder", () => {
  const opts = { symbols: ["AAA", "BBB"], lateThresholdMs: 1000 };

  it("computes latency distribution and late fraction", () => {
    const r = new BarArrivalRecorder(opts);
    [100, 200, 300, 1500].forEach((lag, i) => arrive(r, i % 2 ? "BBB" : "AAA", Math.floor(i / 2), lag));
    const rep = r.report();
    expect(rep.bars).toBe(4);
    expect(rep.latencyMs).toMatchObject({ p50: 200, max: 1500 });
    expect(rep.lateCount).toBe(1);
    expect(rep.lateFraction).toBeCloseTo(0.25);
  });

  it("treats exactly the threshold as on time and counts negative latency", () => {
    const r = new BarArrivalRecorder(opts);
    arrive(r, "AAA", 0, 1000);
    arrive(r, "AAA", 1, -50);
    const rep = r.report();
    expect(rep.lateCount).toBe(0);
    expect(rep.negativeLatencyCount).toBe(1);
  });

  it("batches several bars in one frame and ignores duplicates", () => {
    const r = new BarArrivalRecorder(opts);
    const frame = JSON.stringify([bar("AAA", 0), bar("BBB", 0), bar("AAA", 0)]);
    r.onFrame(frame, T0 + MIN + 10);
    const rep = r.report();
    expect(rep.bars).toBe(2);
    expect(rep.duplicateBars).toBe(1);
  });

  it("finds missing bars within the observed window, per symbol", () => {
    const r = new BarArrivalRecorder(opts);
    for (let m = 0; m < 4; m++) arrive(r, "AAA", m, 100);
    arrive(r, "BBB", 0, 100);
    arrive(r, "BBB", 3, 100); // BBB missing minutes 1 and 2
    const { missing } = r.report();
    expect(missing.expected).toBe(8);
    expect(missing.missing).toBe(2);
    expect(missing.missingFraction).toBeCloseTo(0.25);
    expect(missing.bySymbol).toEqual({ BBB: 2 });
  });

  it("uses an explicit window so an edge outage is counted", () => {
    const r = new BarArrivalRecorder({ ...opts, windowStartMs: T0, windowEndMs: T0 + 3 * MIN });
    arrive(r, "AAA", 0, 100);
    arrive(r, "BBB", 0, 100);
    const { missing } = r.report();
    expect(missing.expected).toBe(6);
    expect(missing.bySymbol).toEqual({ AAA: 2, BBB: 2 });
  });

  it("records corrections, their lag and the corrected fraction", () => {
    const r = new BarArrivalRecorder(opts);
    arrive(r, "AAA", 0, 100);
    arrive(r, "AAA", 1, 100);
    arrive(r, "AAA", 0, 5000, "u");
    arrive(r, "AAA", 0, 9000, "u"); // second correction of the same bar
    const c = r.report().corrections;
    expect(c.updates).toBe(2);
    expect(c.barsCorrected).toBe(1);
    expect(c.fractionOfBarsCorrected).toBeCloseTo(0.5);
    expect(c.withoutOriginal).toBe(0);
    expect(c.lagMs).toMatchObject({ max: 9000 });
  });

  it("counts a correction for a bar that never arrived without inflating the fraction", () => {
    const r = new BarArrivalRecorder(opts);
    arrive(r, "AAA", 0, 100);
    arrive(r, "BBB", 0, 7000, "u");
    const c = r.report().corrections;
    expect(c.withoutOriginal).toBe(1);
    expect(c.barsCorrected).toBe(0);
    expect(c.fractionOfBarsCorrected).toBe(0);
  });

  it("captures server error frames, subscription acks and bad frames", () => {
    const r = new BarArrivalRecorder(opts);
    r.onFrame(JSON.stringify([{ T: "error", code: 405, msg: "symbol limit exceeded" }]), T0);
    r.onFrame(JSON.stringify([{ T: "subscription", bars: ["AAA"], updatedBars: ["AAA", "BBB"] }]), T0);
    r.onFrame("not json", T0);
    r.onFrame('{"T":"b"}', T0);
    r.onFrame(JSON.stringify([{ T: "b", S: "AAA", t: "garbage" }, null, { T: "q" }]), T0);
    const rep = r.report();
    expect(r.hasErrors()).toBe(true);
    expect(rep.errors).toEqual([{ code: 405, msg: "symbol limit exceeded" }]);
    expect(rep.subscriptionAcks).toEqual([{ bars: 1, updatedBars: 2 }]);
    expect(rep.unparseableFrames).toBe(2);
    expect(rep.bars).toBe(0);
    expect(rep.latencyMs).toBeNull();
    expect(rep.missing.expected).toBe(0);
  });
});

describe("cli helpers", () => {
  it("parses and normalizes args, rejects unknown flags", () => {
    const a = parseArgs(["--symbols", "spy, qqq,SPY", "--duration-min", "30", "--confirm-stream-owner"], {});
    expect(a.symbols).toEqual(["SPY", "QQQ"]);
    expect(a.durationMin).toBe(30);
    expect(a.lateMs).toBe(1000);
    expect(a.confirm).toBe(true);
    expect(a.url).toContain("/v2/iex");
    expect(() => parseArgs(["--symbols", "SPY", "--bogus", "1"], {})).toThrow(/unknown flag/);
    expect(() => parseArgs([], {})).toThrow(/required/);
    expect(parseArgs(["--symbols", "SPY"], {}).confirm).toBe(false);
  });

  it("writes a csv with one row per bar", () => {
    const r = new BarArrivalRecorder({ symbols: ["AAA"], lateThresholdMs: 1000 });
    arrive(r, "AAA", 0, 250);
    const lines = barRowsCsv(r.barRows()).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(`AAA,${iso(0)},${T0 + MIN + 250},250`);
  });
});
