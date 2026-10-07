import { buildTradeLedger, tradeStats } from "../../core/analytics/tradeLedger";
import {
  allocatedCapital, buildRunReport, buildStrategyReport, computeRunStats, holdingTimes, openPositions,
  runPnlCurve, slippageSummary, type RunLedger, type RunFill,
} from "../../core/analytics/runPerformance";
import { RunBooks } from "../../core/ledger/runBooks";
import { SignalRecorder } from "../../core/live/signalRecorder";
import { MemoryCache } from "../../utils/cache";

const MIN = 60_000;
const T = Date.parse("2026-10-07T14:00:00Z");

function fill(side: "buy" | "sell", qty: number, price: number, minute: number, extra: Partial<RunFill> = {}): RunFill {
  return { orderId: `o${minute}`, symbol: "SPY", side, qty, price, commission: 0, ts: T + minute * MIN, ...extra };
}

function ledger(fills: RunFill[], extra: Partial<RunLedger> = {}): RunLedger {
  return {
    runId: "run-1", name: "Run", strategyType: "pairs_trading", status: "stopped",
    startedAt: T, stoppedAt: T + 60 * MIN, capitalBase: 10_000,
    fills, orders: fills.map((f) => ({ id: f.orderId, symbol: f.symbol, side: f.side, status: "filled", decisionPrice: null })),
    signalOutcomes: {}, rejectionsByCheck: {}, snapshots: [], ...extra,
  };
}

describe("buildTradeLedger", () => {
  it("closes FIFO, long and short, recording entry, exit and holding time", () => {
    const { trades, openLots } = buildTradeLedger([
      fill("buy", 10, 100, 0), fill("buy", 10, 110, 5), fill("sell", 15, 120, 10),
      fill("sell", 5, 120, 20, { symbol: "QQQ" }), fill("buy", 5, 100, 30, { symbol: "QQQ" }),
    ]);
    expect(trades.map((t) => [t.symbol, t.direction, t.qty, t.pnl, t.holdingMs])).toEqual([
      ["SPY", "long", 10, 200, 10 * MIN],
      ["SPY", "long", 5, 50, 5 * MIN],
      ["QQQ", "short", 5, 100, 10 * MIN],
    ]);
    expect(openLots).toEqual([{ symbol: "SPY", direction: "long", qty: 5, price: 110, ts: T + 5 * MIN }]);
  });

  it("allocates commission to both sides of a trade", () => {
    const { trades } = buildTradeLedger([fill("buy", 2, 100, 0, { commission: 0.02 }), fill("sell", 2, 101, 1, { commission: 0.04 })]);
    expect(trades[0].pnl).toBeCloseTo(2 - 0.06);
  });

  it("tradeStats counts breakeven as a loss, like the backtest", () => {
    expect(tradeStats([10, -5, 0])).toEqual({ totalTrades: 3, winRate: 1 / 3, avgWin: 10, avgLoss: -2.5 });
  });
});

describe("run stats and reports", () => {
  const fills = [fill("buy", 10, 100, 0), fill("sell", 5, 104, 10), fill("buy", 5, 102, 20)];

  it("splits PnL into realized (FIFO) and unrealized at the current mark", () => {
    const stats = computeRunStats(ledger(fills), new Map([["SPY", 105]]), T);
    expect(stats.realizedPnl).toBe(20);
    expect(stats.unrealizedPnl).toBe(5 * 5 + 5 * 3);
    expect(stats.openPositions).toEqual([{ symbol: "SPY", qty: 10, avgPrice: 101, markPrice: 105, unrealizedPnl: 40 }]);
    expect(stats.closedTrades).toBe(1);
  });

  it("reconstructs the curve from fills when the run has no snapshots, ending at total PnL", () => {
    const curve = runPnlCurve(ledger(fills), 60, T + 60 * MIN);
    expect(curve[0]).toEqual({ ts: T, pnl: 0 });
    expect(curve[2].pnl).toBe(40); // after the sell at 104: +20 realized on 5 sold, +20 on the 5 held marked at 104
    expect(curve[curve.length - 1]).toEqual({ ts: T + 60 * MIN, pnl: 60 });
  });

  it("prefers the sampled book when there is one", () => {
    const curve = runPnlCurve(ledger(fills, { snapshots: [
      { ts: T + MIN, realizedPnl: 0, unrealizedPnl: 1 }, { ts: T + 2 * MIN, realizedPnl: 5, unrealizedPnl: 1 },
    ] }), 6, T + 2 * MIN);
    expect(curve.map((p) => p.pnl)).toEqual([0, 1, 6]);
  });

  it("reports the same metric names as a backtest, over the run's capital base", () => {
    const report = buildRunReport(ledger(fills), { marks: new Map([["SPY", 105]]), now: T + 60 * MIN });
    expect(report.metrics).toMatchObject({ totalReturn: 60, totalReturnPct: 60 / 10_000, totalTrades: 1, realizedPnl: 20, unrealizedPnl: 40 });
    expect(report.capitalBase).toBe(10_000);
    expect(report.bySymbol[0]).toMatchObject({ symbol: "SPY", realizedPnl: 20, unrealizedPnl: 40, trades: 1 });
  });

  it("chains a strategy's runs by dollar PnL without netting them against each other", () => {
    const a = ledger([fill("buy", 1, 100, 0), fill("sell", 1, 110, 5)], { runId: "a", stoppedAt: T + 10 * MIN });
    const b = ledger([fill("sell", 1, 120, 30), fill("buy", 1, 125, 40)], { runId: "b", startedAt: T + 30 * MIN, stoppedAt: T + 50 * MIN });
    const summaries = ["b", "a"].map((runId) => ({
      runId, name: runId, status: "stopped", executionMode: "paper", runtimeOrigin: "x", versionId: null,
      versionNumber: null, sandbox: false, backfill: false, startedAt: null, stoppedAt: null,
    }));
    const report = buildStrategyReport("s1", "S", "pairs_trading", [b, a], summaries, { marks: new Map(), now: T + 60 * MIN });
    expect(report.metrics.totalReturn).toBe(10 - 5);
    expect(report.metrics.totalTrades).toBe(2);
    expect(report.equityCurve[report.equityCurve.length - 1].pnl).toBe(5);
    // Run b's curve starts from where run a ended.
    expect(report.equityCurve.find((p) => p.runId === "b")!.pnl).toBe(10);
    expect(report.runs!.map((r) => [r.runId, r.pnl])).toEqual([["b", -5], ["a", 10]]);
  });

  it("measures slippage against the decision price, positive meaning worse", () => {
    const s = slippageSummary(
      [fill("buy", 10, 100.1, 0, { orderId: "x" }), fill("sell", 10, 99.8, 1, { orderId: "y" })],
      [{ id: "x", symbol: "SPY", side: "buy", status: "filled", decisionPrice: 100 },
        { id: "y", symbol: "SPY", side: "sell", status: "filled", decisionPrice: 100 }],
    );
    expect(s.measuredFills).toBe(2);
    expect(s.avgBps).toBeCloseTo(15);
    expect(s.totalCost).toBeCloseTo(1 + 2);
  });

  it("buckets holding times", () => {
    const { trades } = buildTradeLedger([fill("buy", 1, 1, 0), fill("sell", 1, 2, 3)]);
    expect(holdingTimes(trades).find((b) => b.bucket === "1–5 min")).toEqual({ bucket: "1–5 min", trades: 1, pnl: 1 });
  });

  it("marks open positions at the last fill when no live price is known", () => {
    expect(openPositions([fill("sell", 2, 50, 0, { symbol: "MU" })], new Map())[0]).toMatchObject({ qty: -2, markPrice: 50, unrealizedPnl: 0 });
  });

  it("allocates a run its budget share of equity", () => {
    expect(allocatedCapital({ riskBudget: { maxCapitalPct: 0.05 } }, 100_000)).toBe(5_000);
    expect(allocatedCapital(undefined, 100_000)).toBe(100_000);
    expect(allocatedCapital({ riskBudget: { maxCapitalPct: 0.05 } }, undefined)).toBeNull();
  });
});

describe("RunBooks", () => {
  it("keeps each run's positions separate and samples only held runs", () => {
    const books = new RunBooks();
    const base = { id: "f", orderId: "o", commission: 0, isoTs: "", notional: 0 };
    books.applyFill("a", { ...base, symbol: "SPY", side: "buy", qty: 10, price: 100, ts: T });
    books.applyFill("b", { ...base, symbol: "SPY", side: "sell", qty: 5, price: 100, ts: T });
    books.updatePrice("SPY", 101);
    const rows = books.snapshot(["a"], T + MIN);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runId: "a", unrealizedPnl: 10, netExposure: 1010, grossExposure: 1010 });
    expect(books.has("b")).toBe(false);
  });
});

describe("SignalRecorder", () => {
  const signal = { strategyId: "cfg", symbol: "SPY", direction: "long", qty: 1 } as never;

  it("writes a signal with the first outcome it got before the flush", async () => {
    const insert = jest.fn(async () => {});
    const setOutcome = jest.fn(async () => {});
    const rec = new SignalRecorder({ insert, setOutcome, brokerAccount: "A" });
    rec.record("s1", "run-1", T, signal);
    rec.outcome("s1", "risk_rejected", "COOLDOWN");
    rec.outcome("s1", "submitted");
    await rec.flush();
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({ id: "s1", run_id: "run-1", outcome: "risk_rejected", outcome_reason: "COOLDOWN" })]);
    expect(setOutcome).not.toHaveBeenCalled();
  });

  it("applies an outcome that arrives after the signal was written", async () => {
    const setOutcome = jest.fn(async () => {});
    const rec = new SignalRecorder({ insert: async () => {}, setOutcome, brokerAccount: null });
    rec.record("s2", null, T, signal);
    await rec.flush();
    rec.outcome("s2", "submitted");
    await rec.flush();
    expect(setOutcome).toHaveBeenCalledWith("s2", "submitted", null);
  });
});

describe("MemoryCache", () => {
  it("expires entries and shares one load between concurrent misses", async () => {
    let now = 0;
    const cache = new MemoryCache(10, () => now);
    const load = jest.fn(async () => 42);
    const [a, b] = await Promise.all([cache.getOrLoad("k", 1000, load), cache.getOrLoad("k", 1000, load)]);
    expect([a, b]).toEqual([42, 42]);
    expect(load).toHaveBeenCalledTimes(1);
    now = 1001;
    expect(cache.get("k")).toBeUndefined();
  });

  it("evicts the oldest entry past its size", () => {
    const cache = new MemoryCache(2);
    cache.set("a", 1, 1000); cache.set("b", 2, 1000); cache.set("c", 3, 1000);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });
});
