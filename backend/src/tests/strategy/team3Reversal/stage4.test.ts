import { readFileSync } from "fs";
import path from "path";
import { TEAM3_GROUPS, TEAM3_WINDOWS, universeOf } from "../../../strategies/team3Reversal/contract/protocol";
import { earningsDays, earningsFilings } from "../../../runtime/team3Analysis/earnings";
import { earningsSplit, tagEarnings, verdict, works } from "../../../runtime/team3Analysis/stage4Tests";

describe("Stage 4 protocol", () => {
  it("the expanded group is exactly the frozen universe.json symbols", () => {
    const u = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../docs/team3/stage4/universe.json"), "utf8"));
    expect(TEAM3_GROUPS.expanded).toEqual(["SPY", ...u.selected.map((s: { symbol: string }) => s.symbol)]);
    expect(universeOf(TEAM3_GROUPS.expanded)).toBe("expanded");
    expect(universeOf(TEAM3_GROUPS.momentum)).toBe("momentum");
  });

  it("windows match the Stage 4 plan", () => {
    expect(TEAM3_WINDOWS.s4a).toEqual({ startDate: "2026-09-01T00:00:00Z", endDate: "2026-11-20T23:59:59Z" });
    expect(TEAM3_WINDOWS.t1.startDate).toBe("2025-09-01T00:00:00Z");
    expect(TEAM3_WINDOWS.t2).toEqual({ startDate: "2025-12-01T00:00:00Z", endDate: "2026-02-28T23:59:59Z" });
    expect(TEAM3_WINDOWS.t4.endDate).toBe("2026-08-31T23:59:59Z");
    // 4b ends before in-sample starts.
    expect(Date.parse(TEAM3_WINDOWS.t4.endDate)).toBeLessThan(Date.parse(TEAM3_WINDOWS.in.startDate));
  });
});

describe("earnings tags", () => {
  it("acceptance times are UTC: after 16:00 ET tags the next weekday too; before the open only the day", () => {
    expect(earningsDays({ filed: "2025-11-19", accepted: "2025-11-19T21:20:00.000Z" })).toEqual(["2025-11-19", "2025-11-20"]); // NVDA 16:20 ET
    expect(earningsDays({ filed: "2025-11-21", accepted: "2025-11-21T21:05:00.000Z" })).toEqual(["2025-11-21", "2025-11-24"]); // Fri -> Mon
    expect(earningsDays({ filed: "2025-10-29", accepted: "2025-10-29T11:30:00.000Z" })).toEqual(["2025-10-29"]); // BA 07:30 ET
    expect(earningsDays({ filed: "2025-11-20", accepted: "2025-11-20T01:30:00.000Z" })).toEqual(["2025-11-19", "2025-11-20"]); // 20:30 ET the day before
    expect(earningsDays({ filed: "2025-11-20", accepted: "2025-11-20T17:00:00.000Z" })).toEqual(["2025-11-20"]); // 12:00 ET
  });

  it("keeps only 8-K item 2.02 filings in range", () => {
    const f = earningsFilings({
      form: ["8-K", "8-K", "10-Q", "8-K"],
      filingDate: ["2025-11-20", "2025-11-21", "2025-11-20", "2024-01-01"],
      acceptanceDateTime: ["2025-11-20T16:21:08.000Z", "2025-11-21T09:00:00.000Z", "2025-11-20T17:00:00.000Z", "2024-01-01T16:30:00.000Z"],
      items: ["2.02,9.01", "5.02", "", "2.02"],
    });
    expect(f).toEqual([{ filed: "2025-11-20", accepted: "2025-11-20T16:21:08.000Z" }]);
  });

  it("tags trades by ET entry day and splits the bps", () => {
    const ts = Date.parse("2025-11-21T15:00:00Z"); // 10:00 ET on 2025-11-21
    const t = tagEarnings([
      { key: `NVDA@${ts}`, netUsd: 10, notional: 5000 },
      { key: `NVDA@${ts + 3 * 86_400_000}`, netUsd: -5, notional: 5000 },
    ], { NVDA: ["2025-11-21"] });
    expect(t.map((x) => x.earnings)).toEqual([true, false]);
    expect(earningsSplit(t)).toMatchObject({ earningsTrades: 1, allBps: 5, earningsBps: 20, nonEarningsBps: -10, mostlyEarnings: true });
  });
});

describe("Stage 4 verdict", () => {
  const all = { T1: true, T2: true, T3: true, T4: true };
  it("maps results to the pre-registered readings", () => {
    expect(verdict("profitable", all, "profitable")).toBe("general");
    expect(verdict("not profitable", all, "profitable")).toBe("specific to Momentum names");
    expect(verdict("profitable", { T1: false, T2: false, T3: true, T4: true }, "not profitable")).toBe("specific to recent conditions");
    expect(verdict("not profitable", { T1: false, T2: false, T3: false, T4: true }, "not profitable")).toBe("Stage 3 likely luck");
    expect(verdict("inconclusive", { T1: true, T2: true, T3: false, T4: false }, "not profitable")).toBe("mixed");
    expect(verdict("profitable", { T1: true, T2: true, T3: true, T4: false }, "not profitable")).toBe("mixed");
  });

  it("a window works only with >= 10 trades and a positive estimate", () => {
    expect(works({ n: 10, point: 0.1 })).toBe(true);
    expect(works({ n: 9, point: 50 })).toBe(false);
    expect(works({ n: 30, point: -1 })).toBe(false);
  });
});
