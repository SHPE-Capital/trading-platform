import { describe, expect, it } from "vitest";
import {
  MAX_HOLDING_MINS, describeHoldingMs, describeMinutes, maxHoldingHint, maxHoldingProblem, pairsMaxHoldingMs,
} from "../../utils/holdingTime";

describe("maxHoldingProblem", () => {
  it("accepts the bounds", () => {
    expect(maxHoldingProblem(1)).toBeNull();
    expect(maxHoldingProblem(1_440)).toBeNull();
    expect(maxHoldingProblem(MAX_HOLDING_MINS)).toBeNull();
  });

  it.each([NaN, Infinity, 0, -5, 1.5])("rejects %p", (v) => {
    expect(maxHoldingProblem(v)).not.toBeNull();
  });

  it("explains a milliseconds-in-minutes mistake", () => {
    expect(maxHoldingProblem(86_400_000)).toMatch(/not milliseconds/);
  });
});

describe("display helpers", () => {
  it("describes a limit at human scale", () => {
    expect(describeMinutes(1_440)).toBe("1 days");
    expect(describeHoldingMs(86_400_000)).toBe("1 days");
    expect(describeHoldingMs(undefined)).toBe("—");
  });

  it("says in the hint that the limit is hard", () => {
    expect(maxHoldingHint(90)).toMatch(/hard limit/);
  });

  it("reads the limit only for pairs trading", () => {
    expect(pairsMaxHoldingMs("pairs_trading", { maxHoldingTimeMs: 60_000 })).toBe(60_000);
    expect(pairsMaxHoldingMs("minute_reversal", { maxHoldingTimeMs: 60_000 })).toBeUndefined();
    expect(pairsMaxHoldingMs("pairs_trading", {})).toBeUndefined();
    expect(pairsMaxHoldingMs("pairs_trading", { maxHoldingTimeMs: NaN })).toBeUndefined();
  });
});
