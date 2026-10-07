import { beforeEach, describe, expect, it, vi } from "vitest";
import { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import type { PerformanceReport } from "../../types/analytics";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("../../services/performanceService", () => ({
  fetchRunPerformance: vi.fn(),
  fetchStrategyPerformance: vi.fn(),
  fetchRunFills: vi.fn(async () => []),
  fetchRunSignals: vi.fn(async () => []),
}));
vi.mock("../../services/strategiesService", () => ({
  fetchStrategyRun: vi.fn(),
  stopStrategyRun: vi.fn(),
}));
vi.mock("../../services/portfolioService", () => ({ fetchOrders: vi.fn(async () => []) }));
vi.mock("../../services/backtestService", () => ({ fetchBacktests: vi.fn(async () => []) }));
vi.mock("../../hooks/useStrategyVersions", () => ({
  useStrategyVersions: () => ({ versions: [{ id: "ver-2", versionNumber: 2 }], isLoading: false, error: null, refetch: vi.fn() }),
}));

import RunPage from "../../app/runs/[runId]/page";
import StrategyPerformancePage from "../../app/strategies/[id]/page";
import * as perf from "../../services/performanceService";
import * as strategies from "../../services/strategiesService";
import * as backtests from "../../services/backtestService";

function settledParams<T>(value: T): Promise<T> {
  return Object.assign(Promise.resolve(value), { status: "fulfilled", value });
}

function report(overrides: Partial<PerformanceReport> = {}): PerformanceReport {
  return {
    scope: "run", id: "run-1", name: "Minute Reversal (Oct 6–7 local test)", strategyType: "minute_reversal",
    capitalBase: 100_000, periodStart: 1, periodEnd: 2,
    metrics: {
      totalReturn: -116.19, totalReturnPct: -0.0012, maxDrawdown: 0.002, winRate: 0.48, totalTrades: 243,
      avgWin: 0.47, avgLoss: -0.94, profitFactor: 0.46, realizedPnl: -63.52, unrealizedPnl: -52.67, fees: 0,
    },
    equityCurve: [{ ts: 1, equity: 100_000, pnl: 0 }, { ts: 2, equity: 99_883.81, pnl: -116.19 }],
    trades: [{ symbol: "TSLA", direction: "short", qty: 1, entryTs: 1, exitTs: 2, entryPrice: 376, exitPrice: 375, pnl: 1, commission: 0, holdingMs: 60_000 }],
    bySymbol: [{ symbol: "MU", realizedPnl: -25.68, unrealizedPnl: -34.5, trades: 23, winRate: 0.4 }],
    openPositions: [{ symbol: "MU", qty: -2, avgPrice: 1069.82, markPrice: 1087, unrealizedPnl: -34.5 }],
    funnel: { signals: 0, submitted: 0, riskRejected: 0, capitalUnavailable: 0, noOrder: 0, orders: 493, filledOrders: 493, canceledOrders: 0, rejectedOrders: 0, fills: 493 },
    rejectionsByCheck: [{ check: "ORDER_COOLDOWN", count: 4 }],
    slippage: { measuredFills: 0, avgBps: 0, medianBps: 0, totalCost: 0, bySymbol: [] },
    holdingTimes: [{ bucket: "1–5 min", trades: 158, pnl: -20 }],
    exposureCurve: [],
    events: [{ ts: 1, type: "STOPPED", detail: "stopped by lead@shpe.test" }],
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("Run page", () => {
  it("shows the run's live performance and the diagnostics behind it", async () => {
    vi.mocked(perf.fetchRunPerformance).mockResolvedValue(report());
    vi.mocked(strategies.fetchStrategyRun).mockResolvedValue({
      id: "run-1", strategyId: "strat-mr", name: "Minute Reversal: large caps", status: "stopped",
      strategyType: "minute_reversal", config: {}, executionMode: "paper", totalSignals: 0, totalOrders: 493, realizedPnl: -63.52,
    });
    render(<Suspense fallback={<p>loading</p>}><RunPage params={settledParams({ runId: "run-1" })} /></Suspense>);

    expect(await screen.findByRole("heading", { name: "Minute Reversal (Oct 6–7 local test)" })).toBeInTheDocument();
    expect(screen.getByText("-$63.52")).toBeInTheDocument();
    expect(screen.getByText("ORDER_COOLDOWN")).toBeInTheDocument();
    expect(screen.getByText(/stopped but still holds these/)).toBeInTheDocument();
    expect(screen.getByText("STOPPED")).toBeInTheDocument();
    expect(await screen.findByText(/All runs of Minute Reversal: large caps/)).toHaveAttribute("href", "/strategies/strat-mr");
  });
});

describe("Strategy performance page", () => {
  it("chains the strategy's runs and links each one", async () => {
    vi.mocked(perf.fetchStrategyPerformance).mockResolvedValue(report({
      scope: "strategy", id: "strat-mr", name: "Minute Reversal: large caps",
      runs: [{
        runId: "run-1", name: "Minute Reversal (Oct 6–7 local test)", status: "stopped", executionMode: "paper",
        runtimeOrigin: "local-docker", versionId: null, versionNumber: null, sandbox: false, backfill: true,
        startedAt: 1, stoppedAt: 2, pnl: -116.19, trades: 243, orders: 493, signals: 0,
      }],
    }));
    vi.mocked(backtests.fetchBacktests).mockResolvedValue([]);
    render(<Suspense fallback={<p>loading</p>}><StrategyPerformancePage params={settledParams({ id: "strat-mr" })} /></Suspense>);

    expect(await screen.findByRole("heading", { name: "Minute Reversal: large caps" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Minute Reversal (Oct 6–7 local test)" })).toHaveAttribute("href", "/runs/run-1");
    expect(screen.getByText("backfilled")).toBeInTheDocument();
    expect(screen.getByText(/No saved backtest of this strategy/)).toBeInTheDocument();
    expect(perf.fetchStrategyPerformance).toHaveBeenCalledWith("strat-mr", { mode: "paper", versionId: undefined, sandbox: "include" });
  });

  it("forwards an old /strategies/<runId> link to the run page", async () => {
    vi.mocked(perf.fetchStrategyPerformance).mockRejectedValue(new Error("Strategy run-9 not found"));
    vi.mocked(strategies.fetchStrategyRun).mockResolvedValue({ id: "run-9" } as never);
    render(<Suspense fallback={<p>loading</p>}><StrategyPerformancePage params={settledParams({ id: "run-9" })} /></Suspense>);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/runs/run-9"));
  });
});
