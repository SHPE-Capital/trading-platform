import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PerformanceReport } from "../../types/analytics";

vi.mock("../../services/performanceService", () => ({ compareRunWithBacktest: vi.fn() }));
vi.mock("../../services/backtestService", () => ({ fetchBacktest: vi.fn(), saveBacktest: vi.fn(async () => ({ id: "bt-9", alreadySaved: false })) }));

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

beforeEach(() => vi.clearAllMocks());

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

  it("keeps polling while the backtest is queued", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(backtests.fetchBacktest)
      .mockResolvedValueOnce({ id: "bt-1", status: "queued" } as never)
      .mockResolvedValueOnce({ id: "bt-1", status: "failed", error_message: "no bars", config: { initialCapital: 1 } } as never);
    render(<CompareSection report={report} run={{ id: "run-p", strategyType: "pairs_trading", compareBacktestId: "bt-1" }} />);
    expect(await screen.findByText(/Backtest queued/)).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await screen.findByText(/Backtest failed: no bars/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("explains when the strategy type cannot be backtested", () => {
    render(<CompareSection report={report} run={{ id: "run-m", strategyType: "minute_reversal" }} />);
    expect(screen.getByText(/Backtesting is not available for minute_reversal yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
