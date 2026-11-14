import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MomentumResultsView } from "../../features/momentum/results/MomentumResultsView";
import { buildMockSummary } from "../../features/momentum/results/mockData";
import { pairedExcludesZero, scale, chartLabel } from "../../features/momentum/results/format";
import { useMomentumResults } from "../../features/momentum/results/useMomentumResults";
import MomentumResultsPage from "../../app/momentum/results/page";

describe("results helpers", () => {
  it("detects whether the primary interval excludes zero", () => {
    const s = buildMockSummary();
    expect(pairedExcludesZero(s.paired)).toBe(false);
    const excl = { ...s.paired, intervals: [{ blockLength: 5, primary: true, lo: 0.0001, hi: 0.002 }] };
    expect(pairedExcludesZero(excl)).toBe(true);
  });

  it("maps a flat domain to the middle of the range", () => {
    expect(scale(5, 5, 5, 0, 10)).toBe(5);
    expect(scale(1, 0, 2, 0, 10)).toBe(5);
  });
});

describe("MomentumResultsView", () => {
  it("renders from the fixture with the required chart labels and no-deployment weeks", () => {
    const s = buildMockSummary();
    render(<MomentumResultsView summary={s} />);
    expect(screen.getAllByText(chartLabel(s.meta))).toHaveLength(4);
    expect(screen.getByRole("img", { name: /Equity curves/ })).toBeInTheDocument();
    expect(screen.getAllByText("No deployment")).toHaveLength(2);
    expect(screen.getByText(/includes zero, so not distinguishable/)).toBeInTheDocument();
    expect(screen.getByText("1h 30m")).toBeInTheDocument();
  });

  it("does not crash on empty series", () => {
    const s = { ...buildMockSummary(), equity: [], costSensitivity: [], weekly: [] };
    render(<MomentumResultsView summary={s} />);
    expect(screen.getByText("No equity data.")).toBeInTheDocument();
  });
});

describe("MomentumResultsPage", () => {
  it("loads the mock summary", async () => {
    render(<MomentumResultsPage />);
    await waitFor(() => expect(screen.getByText("Policy comparison")).toBeInTheDocument());
  });

  it("surfaces client failures", async () => {
    const failing = { getSummary: async () => { throw new Error("boom"); } };
    function Probe() {
      const { error } = useMomentumResults(failing);
      return <p>{error}</p>;
    }
    render(<Probe />);
    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
  });
});
