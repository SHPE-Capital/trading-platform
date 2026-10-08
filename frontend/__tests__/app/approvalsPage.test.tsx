import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const auth = vi.hoisted(() => ({
  user: { id: "u1", email: "m@shpe.test", role: "member", displayName: "M" } as null | Record<string, string>,
  isLoading: false,
}));

vi.mock("../../context/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("../../hooks/useProposals", () => ({
  usePendingApprovals: vi.fn(),
  useAllProposals: vi.fn(),
}));

import ApprovalsPage from "../../app/approvals/page";
import { useAllProposals, usePendingApprovals } from "../../hooks/useProposals";

const pending = (over: Record<string, unknown> = {}) => ({
  proposalId: "p1", title: "Promote XOM/CVX", description: null, requestedAt: Date.now() - 3_600_000,
  strategyId: "s1", strategyName: "Pairs: XOM/CVX", strategyType: "pairs_trading", headVersionId: "v3",
  versionNumber: 3, proposedConfig: {}, changeSummary: null, versionCreatedAt: 0, requestedById: "a",
  requestedByName: "Ana", requestedByEmail: "ana@shpe.test", backtestCount: 2, latestBacktestAt: null,
  commentCount: 1, changesRequested: false, ...over,
});

const summary = (over: Record<string, unknown> = {}) => ({
  proposalId: "p9", title: "Promote KO/PEP", description: null, status: "rejected", requestedAt: Date.now() - 86_400_000,
  updatedAt: 0, strategyId: "s2", strategyName: "Pairs: KO/PEP", strategyType: "pairs_trading", headVersionId: "v1",
  versionNumber: 1, changeSummary: null, requestedById: "b", requestedByName: "Luis", requestedByEmail: "l@shpe.test",
  approvedBy: null, approvedByName: null, approvedAt: null, approvedCapitalPct: null, rejectedBy: "lead",
  rejectedByName: "Lead", rejectedAt: 0, rejectionReason: "Not cointegrated", backtestCount: 0, commentCount: 0,
  changesRequested: false, ...over,
});

beforeEach(() => {
  auth.user = { id: "u1", email: "m@shpe.test", role: "member", displayName: "M" };
  vi.mocked(usePendingApprovals).mockReturnValue({
    approvals: [pending({ changesRequested: true })] as never, isLoading: false, error: null, refetch: vi.fn(),
  });
  vi.mocked(useAllProposals).mockReturnValue({
    proposals: [summary(), summary({ proposalId: "p10", title: "Promote GLD/SLV", status: "approved", approvedByName: "Lead", approvedCapitalPct: 0.15, rejectionReason: null })] as never,
    isLoading: false, error: null, refetch: vi.fn(),
  });
});

describe("approvals page", () => {
  it("in-progress tab flags proposals waiting on the author's changes", () => {
    render(<ApprovalsPage />);
    expect(screen.getByText("Promote XOM/CVX")).toBeInTheDocument();
    expect(screen.getByText("Changes requested")).toBeInTheDocument();
    expect(screen.queryByText("Promote KO/PEP")).not.toBeInTheDocument();
  });

  it("the All tab lists settled proposals with how they were settled", async () => {
    render(<ApprovalsPage />);
    await userEvent.click(screen.getByRole("button", { name: "All" }));

    expect(screen.getByText("Promote KO/PEP")).toBeInTheDocument();
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.getByText(/Not cointegrated/)).toBeInTheDocument();
    expect(screen.getByText(/Approved by Lead · sized to 15.0%/)).toBeInTheDocument();
  });

  it("asks a signed-out visitor to sign in", () => {
    auth.user = null;
    render(<ApprovalsPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });
});
