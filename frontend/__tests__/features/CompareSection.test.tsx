import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PerformanceReport } from "../../types/analytics";
import type { BacktestJobHandlers } from "../../lib/watchBacktestJob";

vi.mock("../../services/performanceService", () => ({ compareRunWithBacktest: vi.fn() }));
vi.mock("../../services/backtestService", () => ({ fetchBacktest: vi.fn(), saveBacktest: vi.fn(async () => ({ id: "bt-9", alreadySaved: false })) }));

/** Captures the handlers a comparison passes to the Realtime job watcher. */
const watch = vi.hoisted(() => ({ calls: [] as { jobId: string; handlers: BacktestJobHandlers }[] }));
vi.mock("../../lib/watchBacktestJob", () => ({
  watchBacktestJob: (jobId: string, handlers: BacktestJobHandlers) => {
    watch.calls.push({ jobId, handlers });
    return vi.fn();
  },
}));

import CompareSection from "../../features/performance/CompareSection";
import * as perf from "../../services/performanceService";
import * as backtests from "../../services/backtestService";

const report = {
  scope: "run", id: "run-p", name: "Pairs", strategyType: "pairs_trading", capitalBase: 5_000, periodStart: 1, periodEnd: 3,
  metrics: { totalReturn: 50, totalReturnPct: 0.01, maxDrawdown: 0, winRate: 1, totalTrades: 1, avgWin: 50, avgLoss: 0, realizedPnl: 50, unrealizedPnl: 0, fees: 0, benchmarkReturn: 0.004 },
  equityCurve: [{ ts: 1, equity: 5_000, pnl: 0 }, { ts: 3, equity: 5_050, pnl: 50 }],
  benchmark: { symbol: "SPY", curve: [{ ts: 1, pnl: 0 }, { ts: 3, pnl: 20 }] },
  trades: [], bySymbol: [], openPositions: [], rejectionsByCheck: [], holdingTimes: [], exposureCurve: [],
  funnel: { signals: 0, submitted: 0, riskRejected: 0, capitalUnavailable: 0, noOrder: 0, orders: 0, filledOrders: 0, canceledOrders: 0, rejectedOrders: 0, fills: 0 },
  slippage: { measuredFills: 0, avgBps: 0, medianBps: 0, totalCost: 0, bySymbol: [] },
} as PerformanceReport;

beforeEach(() => {
  vi.clearAllMocks();
  watch.calls = [];
});

describe("CompareSection", () => {
  it("shows the benchmark over the same window beside live", () => {
    render(<CompareSection report={report} />);
    expect(screen.getByText(/SPY over the same window/)).toBeInTheDocument();
    expect(screen.getByText("0.40%")).toBeInTheDocument();
    expect(screen.getByText(/SPY buy & hold/)).toBeInTheDocument();
  });

  it("queues a backtest of the run's window and overlays it once complete", async () => {
    vi.mocked(perf.compareRunWithBacktest).mockResolvedValue({ backtestId: "bt-9" });
    vi.mocked(backtests.fetchBacktest).mockResolvedValue({
      id: "bt-9", status: "completed", started_at: 1,
      config: { name: "bt", strategyConfig: {}, startDate: "", endDate: "", initialCapital: 5_000, dataGranularity: "bar", commissionPerShare: 0 },
      metrics: { totalReturn: 30, totalReturnPct: 0.006, maxDrawdown: 0, winRate: 1, totalTrades: 1, avgWin: 30, avgLoss: 0 },
      equity_curve: [{ ts: 1, equity: 5_000 }, { ts: 3, equity: 5_030 }],
    } as never);

    render(<CompareSection report={report} run={{ id: "run-p", strategyType: "pairs_trading" }} />);
    await userEvent.click(screen.getByRole("button", { name: "Compare with a backtest of this window" }));

    expect(perf.compareRunWithBacktest).toHaveBeenCalledWith("run-p", false);
    expect(await screen.findByText("Backtest of this window")).toBeInTheDocument();
    expect(screen.getByText(/^Backtest:/)).toBeInTheDocument();
    // Kept: an unsaved comparison would expire.
    expect(backtests.saveBacktest).toHaveBeenCalledWith("bt-9");
  });

  it("queues a quote-fill comparison on its own and shows how its fills were priced", async () => {
    vi.mocked(perf.compareRunWithBacktest).mockResolvedValue({ backtestId: "bt-q" });
    vi.mocked(backtests.fetchBacktest).mockResolvedValue({
      id: "bt-q", status: "completed", started_at: 1,
      config: { name: "bt", strategyConfig: {}, startDate: "", endDate: "", initialCapital: 5_000, dataGranularity: "bar", commissionPerShare: 0 },
      metrics: {
        totalReturn: 20, totalReturnPct: 0.004, maxDrawdown: 0, winRate: 1, totalTrades: 1, avgWin: 20, avgLoss: 0,
        meta: {
          execution: {
            model: "quote", latencyMs: 250, feed: "sip", extraSlippageBps: 0, fills: { quote: 2, trade: 0, bar: 0 },
            fallbacks: {}, expiredUnmarketable: 0, tradeDataUnavailable: 0, avgSpreadCostBps: 0.5, avgDelayCostBps: 0.1,
          },
        },
      },
      equity_curve: [{ ts: 1, equity: 5_000 }, { ts: 3, equity: 5_020 }],
    } as never);

    render(<CompareSection report={report} run={{ id: "run-p", strategyType: "pairs_trading" }} />);
    await userEvent.click(screen.getByRole("button", { name: "Compare with quote fills" }));

    expect(perf.compareRunWithBacktest).toHaveBeenCalledWith("run-p", false, { model: "quote" });
    expect(await screen.findByText("Backtest of this window, quote fills")).toBeInTheDocument();
    expect(screen.getByText(/^Backtest, quote fills:/)).toBeInTheDocument();
    expect(screen.getByText("0.50 bps")).toBeInTheDocument();
    // The bar-fill comparison is separate and was not queued.
    expect(screen.queryByText("Backtest of this window")).not.toBeInTheDocument();
  });

  it("picks up the run's existing quote-fill comparison", async () => {
    vi.mocked(backtests.fetchBacktest).mockResolvedValue({ id: "bt-q", status: "running" } as never);
    render(<CompareSection report={report} run={{ id: "run-p", strategyType: "pairs_trading", compareQuoteBacktestId: "bt-q" }} />);
    expect(await screen.findByText(/Quote-fill backtest running/)).toBeInTheDocument();
    expect(backtests.fetchBacktest).toHaveBeenCalledWith("bt-q");
    expect(screen.getByRole("button", { name: "Re-run with quote fills" })).toBeDisabled();
  });

  it("follows a queued comparison and reloads it once the job settles", async () => {
    vi.mocked(backtests.fetchBacktest)
      .mockResolvedValueOnce({ id: "bt-1", status: "queued" } as never)
      .mockResolvedValueOnce({
        id: "bt-1", status: "completed", started_at: 1, saved_at: 2,
        config: { name: "bt", strategyConfig: {}, startDate: "", endDate: "", initialCapital: 5_000, dataGranularity: "bar", commissionPerShare: 0 },
        metrics: { totalReturn: 30, totalReturnPct: 0.006, maxDrawdown: 0, winRate: 1, totalTrades: 1, avgWin: 30, avgLoss: 0 },
        equity_curve: [{ ts: 1, equity: 5_000 }, { ts: 3, equity: 5_030 }],
      } as never);
    render(<CompareSection report={report} run={{ id: "run-p", strategyType: "pairs_trading", compareBacktestId: "bt-1" }} />);
    expect(await screen.findByText(/Backtest queued/)).toBeInTheDocument();
    expect(watch.calls.map((c) => c.jobId)).toEqual(["bt-1"]);

    await act(async () => watch.calls[0].handlers.onComplete("bt-1"));
    expect(await screen.findByText("Backtest of this window")).toBeInTheDocument();
  });

  it("shows the worker's failure for a comparison that fails", async () => {
    vi.mocked(backtests.fetchBacktest).mockResolvedValue({ id: "bt-1", status: "running" } as never);
    render(<CompareSection report={report} run={{ id: "run-p", strategyType: "pairs_trading", compareBacktestId: "bt-1" }} />);
    expect(await screen.findByText(/Backtest running/)).toBeInTheDocument();

    act(() => watch.calls[0].handlers.onError("no bars"));
    expect(await screen.findByText(/Backtest failed: no bars/)).toBeInTheDocument();
  });

  it("explains when the strategy type cannot be backtested", () => {
    render(<CompareSection report={report} run={{ id: "run-m", strategyType: "minute_reversal" }} />);
    expect(screen.getByText(/Backtesting is not available for minute_reversal yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
