import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import CapitalExposurePanel from "../../features/approvals/CapitalExposurePanel";
import type { CapitalExposure } from "../../types/review";

function exposure(overrides: Partial<CapitalExposure> = {}): CapitalExposure {
  return {
    executionMode: "paper",
    bookEquity: 100_000,
    liveRuns: [
      { runId: "r1", name: "Pairs: XOM/CVX", ownerName: "Ana", maxCapitalPct: 0.4 },
      { runId: "r2", name: "Pairs: KO/PEP", ownerName: "Luis", maxCapitalPct: 0.3 },
    ],
    allocatedPct: 0.7,
    uncappedRuns: 0,
    proposedPct: 0.2,
    ...overrides,
  };
}

describe("CapitalExposurePanel", () => {
  it("adds the proposal's cap to what is already live", () => {
    render(<CapitalExposurePanel exposure={exposure()} overridePct={null} />);
    expect(screen.getByTestId("after-approval")).toHaveTextContent("90.0% · $90,000");
    expect(screen.getByText("Pairs: XOM/CVX")).toBeInTheDocument();
  });

  it("uses the lead's sizing override instead of the proposed cap", () => {
    render(<CapitalExposurePanel exposure={exposure()} overridePct={0.05} />);
    expect(screen.getByTestId("after-approval")).toHaveTextContent("75.0%");
  });

  it("warns when approving would promise out more than the whole book", () => {
    render(<CapitalExposurePanel exposure={exposure({ proposedPct: 0.5 })} overridePct={null} />);
    expect(screen.getByTestId("after-approval")).toHaveTextContent("120.0%");
    expect(screen.getByText(/exceed the whole book/i)).toBeInTheDocument();
  });

  it("calls out uncapped runs, since the total is then only a lower bound", () => {
    render(<CapitalExposurePanel exposure={exposure({ uncappedRuns: 1 })} overridePct={null} />);
    expect(screen.getByText(/lower bound/i)).toBeInTheDocument();
  });
});
