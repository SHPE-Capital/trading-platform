import { benchmarkPnl, loadBenchmarkCurve } from "../../core/analytics/benchmark";

const DAY = 86_400_000;
const T = Date.parse("2026-10-01T00:00:00Z");

describe("loadBenchmarkCurve", () => {
  it("uses daily bars for long windows and minute bars for short ones", async () => {
    const loader = { loadBars: jest.fn(async () => [{ ts: T, close: 100 }, { ts: T + DAY, close: 101 }]) };
    await loadBenchmarkCurve(loader, "SPY", T, T + 10 * DAY);
    expect(loader.loadBars).toHaveBeenLastCalledWith(["SPY"], new Date(T - DAY).toISOString(), new Date(T + 10 * DAY).toISOString(), "1Day");
    await loadBenchmarkCurve(loader, "SPY", T, T + 3_600_000);
    expect((loader.loadBars.mock.calls as unknown[][]).at(-1)![3]).toBe("1Min");
  });

  it("clamps the first point to the window start and drops bars past the end", async () => {
    const loader = { loadBars: jest.fn(async () => [{ ts: T - DAY, close: 99 }, { ts: T + DAY, close: 101 }, { ts: T + 20 * DAY, close: 120 }]) };
    expect(await loadBenchmarkCurve(loader, "SPY", T, T + 10 * DAY)).toEqual([{ ts: T, value: 99 }, { ts: T + DAY, value: 101 }]);
  });
});

describe("benchmarkPnl", () => {
  it("expresses buy-and-hold as dollar PnL on the capital base", () => {
    const curve = benchmarkPnl([{ ts: 1, value: 100 }, { ts: 2, value: 102 }], 10_000);
    expect(curve.map((p) => p.ts)).toEqual([1, 2]);
    expect(curve[0].pnl).toBe(0);
    expect(curve[1].pnl).toBeCloseTo(200);
    expect(benchmarkPnl([], 10_000)).toEqual([]);
  });
});
