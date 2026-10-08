import { beforeEach, describe, expect, it, vi } from "vitest";
import { Suspense } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProposalDetail } from "../../types/review";

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "lead-1", email: "lead@shpe.test", role: "lead", displayName: "Lead" } }),
}));
vi.mock("../../hooks/useProposals", () => ({ useProposal: vi.fn() }));

import ProposalPage from "../../app/approvals/[id]/page";
import { useProposal } from "../../hooks/useProposals";

const mockUseProposal = vi.mocked(useProposal);

function version(n: number, createdAt: number, config: Record<string, unknown>) {
  return {
    id: `ver-${n}`, strategyId: "strat-1", versionNumber: n, config,
    changeSummary: `change ${n}`, createdBy: "author-1", createdAt, createdByName: "Ana",
  };
}

const v1 = version(1, 1_000, { entryZScore: 2, rollingWindowMs: 3_600_000, riskBudget: { maxCapitalPct: 0.2 } });
const v2 = version(2, 2_000, { entryZScore: 2.5, rollingWindowMs: 3_600_000, riskBudget: { maxCapitalPct: 0.2 } });
const v3 = version(3, 3_000, { entryZScore: 2.5, rollingWindowMs: 7_200_000, riskBudget: { maxCapitalPct: 0.2 } });

function detail(overrides: Partial<ProposalDetail> = {}): ProposalDetail {
  return {
    proposal: {
      id: "p1", strategyId: "strat-1", headVersionId: "ver-3", title: "Promote XOM/CVX", description: null,
      status: "open", requestedBy: "author-1", requestedAt: 500, approvedBy: null, approvedAt: null,
      approvedCapitalPct: null, rejectedBy: null, rejectedAt: null, rejectionReason: null, updatedAt: 3_000,
    },
    strategy: { id: "strat-1", name: "Pairs: XOM/CVX", strategy_type: "pairs_trading" },
    headVersion: v3,
    versions: [v3, v2, v1],
    backtests: [],
    comments: [],
    timeline: [],
    capitalExposure: {
      executionMode: "paper", bookEquity: null,
      liveRuns: [{ runId: "r1", name: "Pairs: KO/PEP", ownerName: "Luis", maxCapitalPct: 0.5 }],
      allocatedPct: 0.5, uncappedRuns: 0, proposedPct: 0.2,
    },
    viewer: { id: "lead-1", role: "lead", canApprove: true, canWithdraw: false },
    ...overrides,
  };
}

const actions = {
  approve: vi.fn(async () => {}),
  reject: vi.fn(async () => {}),
  withdraw: vi.fn(async () => {}),
  comment: vi.fn(async () => {}),
  refetch: vi.fn(),
};

function setDetail(d: ProposalDetail) {
  mockUseProposal.mockReturnValue({
    detail: d, isLoading: false, error: null, isActing: false, actionError: null, ...actions,
  });
}

/**
 * Route params as an already-settled promise. React's use() reads a thenable
 * tagged fulfilled synchronously instead of suspending, which is how Next
 * hands a page params it has already resolved.
 */
function settledParams<T>(value: T): Promise<T> {
  return Object.assign(Promise.resolve(value), { status: "fulfilled", value });
}

async function renderPage() {
  render(
    <Suspense fallback={<p>loading</p>}>
      <ProposalPage params={settledParams({ id: "p1" })} />
    </Suspense>,
  );
  await screen.findByRole("heading", { name: "Promote XOM/CVX" });
}

beforeEach(() => setDetail(detail()));

describe("proposal review page — changes requested", () => {
  it("shows the changes-requested state when feedback is newer than the proposed version", async () => {
    setDetail(detail({
      comments: [{ id: "c1", proposalId: "p1", authorId: "lead-1", body: "widen it", kind: "request_changes", createdAt: 4_000 }],
    }));
    await renderPage();
    expect(screen.getByText(/Changes requested\./)).toBeInTheDocument();
  });

  it("clears once the author pushes a newer version", async () => {
    setDetail(detail({
      comments: [{ id: "c1", proposalId: "p1", authorId: "lead-1", body: "widen it", kind: "request_changes", createdAt: 2_500 }],
    }));
    await renderPage();
    expect(screen.queryByText(/Changes requested\./)).not.toBeInTheDocument();
  });

  it("'Request changes' posts feedback and leaves the proposal open", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Request changes" }));
    await userEvent.type(screen.getByPlaceholderText(/What needs to change/), "Use a 7-day window");
    await userEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    expect(actions.comment).toHaveBeenCalledWith("Use a 7-day window", "request_changes");
    expect(actions.reject).not.toHaveBeenCalled();
  });

  it("rejecting outright is a separate, deliberate action", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Reject this proposal" }));
    await userEvent.type(screen.getByPlaceholderText(/rejected outright/), "Wrong asset class");
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));

    expect(actions.reject).toHaveBeenCalledWith("Wrong asset class");
    expect(actions.comment).not.toHaveBeenCalled();
  });
});

describe("proposal review page — version diff", () => {
  it("diffs the proposed version against the one before it by default", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { name: /Changes in v3 vs v2/ })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("rollingWindowMs")).toBeInTheDocument();
    expect(within(table).queryByText("entryZScore")).not.toBeInTheDocument();
  });

  it("re-bases the diff on any older version picked in the sidebar", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: /^v1/ }));

    expect(screen.getByRole("heading", { name: /Changes in v3 vs v1/ })).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("entryZScore")).toBeInTheDocument();
  });
});

describe("proposal review page — capital exposure", () => {
  it("adds the lead's sizing override to the live total before approving", async () => {
    await renderPage();
    expect(screen.getByTestId("after-approval")).toHaveTextContent("70.0%");

    await userEvent.type(screen.getByLabelText(/Capital allocation/), "10");

    expect(screen.getByTestId("after-approval")).toHaveTextContent("60.0%");
    await userEvent.click(screen.getByRole("button", { name: "Approve & start" }));
    expect(actions.approve).toHaveBeenCalledWith(0.1);
  });
});
