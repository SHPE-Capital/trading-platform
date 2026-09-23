import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const auth = vi.hoisted(() => ({ user: null as null | { id: string; role: string }, isLoading: false }));

vi.mock("../../context/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("../../services/proposalsService", () => ({
  fetchPendingApprovals: vi.fn(),
  fetchAllProposals: vi.fn(),
  fetchProposal: vi.fn(),
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
  withdrawProposal: vi.fn(),
  postComment: vi.fn(),
}));

import { useAllProposals, usePendingApprovals, useProposal } from "../../hooks/useProposals";
import * as service from "../../services/proposalsService";

const svc = vi.mocked(service);

beforeEach(() => {
  auth.user = { id: "u1", role: "lead" };
  auth.isLoading = false;
});

describe("usePendingApprovals", () => {
  it("loads the open queue for a signed-in member", async () => {
    svc.fetchPendingApprovals.mockResolvedValue([{ proposalId: "p1" }] as never);
    const { result } = renderHook(() => usePendingApprovals());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.approvals).toEqual([{ proposalId: "p1" }]);
  });

  it("asks for nothing while signed out", async () => {
    auth.user = null;
    const { result } = renderHook(() => usePendingApprovals());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.approvals).toEqual([]);
    expect(svc.fetchPendingApprovals).not.toHaveBeenCalled();
  });

  it("reports a load failure", async () => {
    svc.fetchPendingApprovals.mockRejectedValue(new Error("Session expired"));
    const { result } = renderHook(() => usePendingApprovals());
    await waitFor(() => expect(result.current.error).toBe("Session expired"));
  });
});

describe("useAllProposals", () => {
  it("loads every proposal for the All tab", async () => {
    svc.fetchAllProposals.mockResolvedValue([{ proposalId: "p1", status: "rejected" }] as never);
    const { result } = renderHook(() => useAllProposals());
    await waitFor(() => expect(result.current.proposals).toHaveLength(1));
  });
});

describe("useProposal", () => {
  beforeEach(() => {
    svc.fetchProposal.mockResolvedValue({ proposal: { id: "p1", status: "open" } } as never);
  });

  it("refetches after an action so the page shows what the server did", async () => {
    svc.approveProposal.mockResolvedValue({} as never);
    const { result } = renderHook(() => useProposal("p1"));
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    expect(svc.fetchProposal).toHaveBeenCalledTimes(1);

    await act(() => result.current.approve(0.1, "sized down"));

    expect(svc.approveProposal).toHaveBeenCalledWith("p1", 0.1, "sized down");
    expect(svc.fetchProposal).toHaveBeenCalledTimes(2);
  });

  it("refetches even when an approve fails — the server may have rolled it back to open", async () => {
    svc.approveProposal.mockRejectedValue(new Error("strategy failed to start — proposal reopened"));
    const { result } = renderHook(() => useProposal("p1"));
    await waitFor(() => expect(result.current.detail).not.toBeNull());

    await act(() => result.current.approve());

    expect(result.current.actionError).toMatch(/reopened/);
    expect(svc.fetchProposal).toHaveBeenCalledTimes(2);
    expect(result.current.isActing).toBe(false);
  });

  it("posts a request-changes comment through the comment endpoint", async () => {
    svc.postComment.mockResolvedValue({} as never);
    const { result } = renderHook(() => useProposal("p1"));
    await waitFor(() => expect(result.current.detail).not.toBeNull());

    await act(() => result.current.comment("widen the window", "request_changes"));

    expect(svc.postComment).toHaveBeenCalledWith("p1", "widen the window", "request_changes");
    expect(svc.rejectProposal).not.toHaveBeenCalled();
  });
});
