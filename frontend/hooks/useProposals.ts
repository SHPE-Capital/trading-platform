/**
 * hooks/useProposals.ts
 *
 * Data hooks for the review workflow: the approvals queue and a single
 * proposal's full detail.
 *
 * Both refetch after any mutating action so the page reflects what the server
 * actually did — particularly important for approve, which can fail after the
 * proposal is settled and get rolled back to open.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchPendingApprovals,
  fetchAllProposals,
  fetchProposal,
  approveProposal,
  rejectProposal,
  withdrawProposal,
  postComment,
} from "../services/proposalsService";
import { useAuth } from "../context/AuthContext";
import type { PendingApproval, ProposalSummary, ProposalDetail, CommentKind } from "../types/review";

interface UsePendingApprovalsResult {
  approvals: PendingApproval[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/** The review queue, oldest request first. */
export function usePendingApprovals(): UsePendingApprovalsResult {
  const { user, isLoading: authLoading } = useAuth();
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setApprovals([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setApprovals(await fetchPendingApprovals());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load approvals");
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) void load();
  }, [authLoading, load]);

  return { approvals, isLoading: isLoading || authLoading, error, refetch: load };
}

interface UseAllProposalsResult {
  proposals: ProposalSummary[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/** Every proposal regardless of status, newest first — the approvals page's "All" tab. */
export function useAllProposals(): UseAllProposalsResult {
  const { user, isLoading: authLoading } = useAuth();
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setProposals([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setProposals(await fetchAllProposals());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load proposals");
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) void load();
  }, [authLoading, load]);

  return { proposals, isLoading: isLoading || authLoading, error, refetch: load };
}

interface UseProposalResult {
  detail: ProposalDetail | null;
  isLoading: boolean;
  error: string | null;
  /** Set while an approve/reject/withdraw/comment request is in flight. */
  isActing: boolean;
  actionError: string | null;
  approve: (capitalPct?: number, note?: string) => Promise<void>;
  reject: (reason: string) => Promise<void>;
  withdraw: () => Promise<void>;
  comment: (body: string, kind?: CommentKind) => Promise<void>;
  refetch: () => void;
}

/** One proposal with its version history, backtests, comments and timeline. */
export function useProposal(id: string): UseProposalResult {
  const { user, isLoading: authLoading } = useAuth();
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setDetail(await fetchProposal(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load proposal");
    } finally {
      setIsLoading(false);
    }
  }, [id, user]);

  useEffect(() => {
    if (!authLoading) void load();
  }, [authLoading, load]);

  /** Runs a mutating action, then refetches so the UI shows the server's truth. */
  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setIsActing(true);
      setActionError(null);
      try {
        await fn();
        await load();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Action failed");
        // Refetch anyway: a failed approve rolls the proposal back to open, and
        // the page must not keep showing it as approved.
        await load();
      } finally {
        setIsActing(false);
      }
    },
    [load],
  );

  return {
    detail,
    isLoading: isLoading || authLoading,
    error,
    isActing,
    actionError,
    approve: (capitalPct, note) => act(() => approveProposal(id, capitalPct, note)),
    reject: (reason) => act(() => rejectProposal(id, reason)),
    withdraw: () => act(() => withdrawProposal(id)),
    comment: (body, kind) => act(() => postComment(id, body, kind)),
    refetch: load,
  };
}
