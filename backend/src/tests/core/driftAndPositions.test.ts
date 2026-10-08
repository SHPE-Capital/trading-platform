import { computeDrift, checkDrift, type DriftStore } from "../../core/ledger/driftCheck";
import { positionsFromFills } from "../../core/ledger/positions";

describe("computeDrift", () => {
  it("reports nothing when running runs account for every position", () => {
    expect(computeDrift(
      [{ symbol: "SPY", qty: 10 }],
      [{ runId: "r1", symbol: "SPY", qty: 6 }, { runId: "r2", symbol: "SPY", qty: 4 }],
      new Set(["r1", "r2"]),
    )).toEqual([]);
  });

  it("flags shares held by stopped runs", () => {
    expect(computeDrift([{ symbol: "SPY", qty: 35 }], [{ runId: "old", symbol: "SPY", qty: 35 }], new Set())).toEqual([
      { symbol: "SPY", brokerQty: 35, runningQty: 0, stoppedQty: 35, unattributedQty: 0 },
    ]);
  });

  it("flags shares no run accounts for, including fills with no run", () => {
    expect(computeDrift(
      [{ symbol: "F", qty: 3 }],
      [{ runId: null, symbol: "F", qty: 3 }],
      new Set(),
    )).toEqual([{ symbol: "F", brokerQty: 3, runningQty: 0, stoppedQty: 0, unattributedQty: 3 }]);
  });

  it("flags a run that believes it holds shares the broker does not", () => {
    expect(computeDrift([], [{ runId: "r1", symbol: "QQQ", qty: 5 }], new Set(["r1"]))).toEqual([
      { symbol: "QQQ", brokerQty: 0, runningQty: 5, stoppedQty: 0, unattributedQty: -5 },
    ]);
  });

  it("checkDrift stores the rows for the account", async () => {
    const store: DriftStore = {
      runPositions: jest.fn(async () => [{ runId: "r1", symbol: "SPY", qty: 1 }]),
      runningRunIds: jest.fn(async () => new Set<string>()),
      replaceDrift: jest.fn(async () => {}),
    };
    const rows = await checkDrift("ACCT", [{ symbol: "SPY", qty: 1 }], store, () => 42);
    expect(store.runningRunIds).toHaveBeenCalledWith(["r1"]);
    expect(store.replaceDrift).toHaveBeenCalledWith("ACCT", rows, 42);
    expect(rows[0].stoppedQty).toBe(1);
  });
});

describe("positionsFromFills", () => {
  it("averages entries and realizes on reductions", () => {
    const p = positionsFromFills([
      { symbol: "SPY", side: "buy", qty: 10, price: 100 },
      { symbol: "SPY", side: "buy", qty: 10, price: 110 },
      { symbol: "SPY", side: "sell", qty: 5, price: 120 },
    ]).get("SPY")!;
    expect(p.qty).toBe(15);
    expect(p.avgPrice).toBe(105);
    expect(p.realizedPnl).toBe(75);
  });

  it("handles shorts and flips through flat", () => {
    const p = positionsFromFills([
      { symbol: "MU", side: "sell", qty: 2, price: 1000 },
      { symbol: "MU", side: "buy", qty: 3, price: 990 },
    ]).get("MU")!;
    expect(p.qty).toBe(1);
    expect(p.avgPrice).toBe(990);
    expect(p.realizedPnl).toBe(20);
  });

  it("charges commissions to realized PnL", () => {
    const p = positionsFromFills([{ symbol: "F", side: "buy", qty: 1, price: 12, commission: 0.01 }]).get("F")!;
    expect(p.realizedPnl).toBeCloseTo(-0.01);
  });
});
