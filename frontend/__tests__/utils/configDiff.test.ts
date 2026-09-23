import { describe, expect, it } from "vitest";
import { diffConfigs, flattenConfig, formatConfigValue } from "../../utils/configDiff";

describe("flattenConfig", () => {
  it("flattens nested objects to dotted paths and keeps arrays whole", () => {
    const flat = flattenConfig({ a: 1, riskBudget: { maxCapitalPct: 0.2 }, symbols: ["XOM", "CVX"] });
    expect(Object.fromEntries(flat)).toEqual({
      a: 1,
      "riskBudget.maxCapitalPct": 0.2,
      symbols: ["XOM", "CVX"],
    });
  });
});

describe("diffConfigs", () => {
  const v1 = {
    entryZScore: 2,
    rollingWindowMs: 3_600_000,
    symbols: ["XOM", "CVX"],
    riskBudget: { maxCapitalPct: 0.2, maxOpenOrders: 4 },
  };

  it("reports one row per changed leaf, not the whole parent object", () => {
    const v2 = { ...v1, riskBudget: { maxCapitalPct: 0.1, maxOpenOrders: 4 } };
    const { rows, unchangedCount } = diffConfigs(v1, v2);
    expect(rows).toEqual([
      { path: "riskBudget.maxCapitalPct", kind: "changed", before: 0.2, after: 0.1 },
    ]);
    expect(unchangedCount).toBe(4);
  });

  it("classifies added and removed fields", () => {
    const v2: Record<string, unknown> = { ...v1, exitZScore: 0.5 };
    delete v2.entryZScore;
    const kinds = Object.fromEntries(diffConfigs(v1, v2).rows.map((r) => [r.path, r.kind]));
    expect(kinds).toEqual({ entryZScore: "removed", exitZScore: "added" });
  });

  it("treats an array change as a single change", () => {
    const { rows } = diffConfigs(v1, { ...v1, symbols: ["XOM", "COP"] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ path: "symbols", kind: "changed" });
  });

  it("reports nothing as changed for a first version", () => {
    expect(diffConfigs(null, v1)).toEqual({ rows: [], unchangedCount: 5 });
  });
});

describe("formatConfigValue", () => {
  it("humanizes millisecond durations so a mis-entered window stands out", () => {
    expect(formatConfigValue("rollingWindowMs", 604_800_000)).toBe("604,800,000 ms (7 days)");
    expect(formatConfigValue("cooldownMs", 60_000)).toBe("60,000 ms (1 min)");
  });

  it("renders book fractions as percentages", () => {
    expect(formatConfigValue("riskBudget.maxCapitalPct", 0.25)).toBe("25.0%");
  });

  it("shows a dash for a missing side", () => {
    expect(formatConfigValue("x", undefined)).toBe("—");
  });
});
