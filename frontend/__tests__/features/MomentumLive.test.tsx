import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MomentumLiveView } from "../../features/momentum/MomentumLiveView";
import { buildMockSnapshot } from "../../features/momentum/mockData";
import { haltUsage, minutesLeft } from "../../features/momentum/format";
import MomentumPage from "../../app/momentum/page";

const NOW = new Date("2026-11-13T15:00:00Z");

describe("momentum format helpers", () => {
  it("computes minutes left against the configured max hold", () => {
    const s = buildMockSnapshot(NOW);
    expect(minutesLeft(s.positions[0], 60, NOW)).toBe(38);
    expect(minutesLeft(s.positions[0], 30, NOW)).toBe(8);
    expect(minutesLeft(s.positions[1], 30, NOW)).toBeLessThan(0);
  });

  it("measures halt usage from loss only", () => {
    expect(haltUsage(-0.005, 0.01)).toBeCloseTo(0.5);
    expect(haltUsage(0.02, 0.01)).toBe(0);
    expect(haltUsage(-0.05, 0.01)).toBe(1);
  });
});

describe("MomentumLiveView", () => {
  it("renders config in plain language, positions and audit chain", () => {
    render(<MomentumLiveView snapshot={buildMockSnapshot(NOW)} now={NOW} />);
    expect(screen.getByText(/20-minute breakout \+ EMA 9\/21 trend/)).toBeInTheDocument();
    expect(screen.getByText("Artifact fresh: 30.0h old (limit 72h)")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("NVDA")).toBeInTheDocument();
    expect(screen.getByText("38 min")).toBeInTheDocument();
    expect(screen.getByText(/halt line -1.00%/)).toBeInTheDocument();
    expect(screen.getByText(/rejected: STALE_QUOTE/)).toBeInTheDocument();
  });

  it("shows disabled entries, stale artifact, no-deployment reason and halt", () => {
    const s = buildMockSnapshot(NOW);
    s.entries = { enabled: false, reason: "Daily halt reached" };
    s.halt = { ...s.halt, halted: true, dayPnlPct: -0.012 };
    s.config.freshnessLimitHours = 12;
    s.config.noDeploymentReason = "no config passed acceptance";
    s.positions = [];
    render(<MomentumLiveView snapshot={s} now={NOW} />);
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("Daily halt reached")).toBeInTheDocument();
    expect(screen.getByText(/Stale artifact/)).toBeInTheDocument();
    expect(screen.getByText(/No deployment this week: no config passed acceptance/)).toBeInTheDocument();
    expect(screen.getByText(/HALTED/)).toBeInTheDocument();
    expect(screen.getByText("No open positions.")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
});

describe("MomentumPage", () => {
  it("loads the mock snapshot", async () => {
    render(<MomentumPage />);
    await waitFor(() => expect(screen.getByText("Active weekly configuration")).toBeInTheDocument());
  });
});
