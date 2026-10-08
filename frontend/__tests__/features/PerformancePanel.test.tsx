import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PerformancePanel from "../../features/performance/PerformancePanel";
import DriftBanner from "../../components/cards/DriftBanner";

const backtestMetrics = {
  totalReturnPct: 0.12, maxDrawdown: 0.05, winRate: 0.6, totalTrades: 40,
  sharpeRatio: 1.42, sortinoRatio: undefined, avgWin: 25, avgLoss: -12,
};

describe("PerformancePanel", () => {
  it("shows a backtest's eight metrics and no live PnL row", () => {
    render(<PerformancePanel metrics={backtestMetrics} curve={[]} showChart={false} />);
    expect(screen.getByText("Total Return")).toBeInTheDocument();
    expect(screen.getByText("1.42")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument(); // no Sortino
    expect(screen.queryByText("Unrealized")).not.toBeInTheDocument();
  });

  it("adds dollar PnL, realized, unrealized and profit factor for a live report", () => {
    render(
      <PerformancePanel
        live
        showChart={false}
        curve={[]}
        metrics={{ ...backtestMetrics, totalReturn: -116.19, realizedPnl: -63.52, unrealizedPnl: -52.67, profitFactor: 0.46 }}
      />,
    );
    expect(screen.getByText("PnL")).toBeInTheDocument();
    expect(screen.getByText("-$63.52")).toBeInTheDocument();
    expect(screen.getByText("-$52.67")).toBeInTheDocument();
    expect(screen.getByText("0.46")).toBeInTheDocument();
  });

  it("draws the curve when asked", () => {
    render(<PerformancePanel metrics={backtestMetrics} curve={[{ ts: 1, equity: 100 }, { ts: 2, equity: 110 }]} />);
    expect(screen.queryByText("No equity curve data")).not.toBeInTheDocument();
  });
});

describe("DriftBanner", () => {
  it("says nothing when every position is managed", () => {
    const { container } = render(<DriftBanner rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names positions held by stopped runs and positions no run accounts for", () => {
    render(<DriftBanner rows={[
      { symbol: "SPY", brokerQty: 35, runningQty: 0, stoppedQty: 35, unattributedQty: 0 },
      { symbol: "F", brokerQty: 3, runningQty: 0, stoppedQty: 0, unattributedQty: 3 },
    ]} />);
    expect(screen.getByText(/Held by stopped runs: SPY 35/)).toBeInTheDocument();
    expect(screen.getByText(/No run accounts for: F 3/)).toBeInTheDocument();
  });
});
