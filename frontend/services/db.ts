/**
 * services/db.ts
 *
 * Read-only history queried straight from Supabase with the member's own
 * session. Row level security (0019) is the gate: only active members read
 * anything. Writes, live state and anything that needs server logic still go
 * through the backend (services/api.ts).
 *
 * Reading here instead of through the backend saves a hop and the backend's
 * per-request auth check, and keeps this traffic off the trading box. Each
 * mapper returns exactly the shape the backend endpoint it replaces returned,
 * so callers did not change.
 */

import { requireSupabase } from "../lib/supabaseClient";
import type { Fill, Order } from "../types/portfolio";
import type { RunSignal } from "../types/analytics";
import type { BacktestResult } from "../types/api";
import type {
  PendingApproval,
  ProposalComment,
  ProposalStatus,
  ProposalSummary,
  StrategyVersion,
} from "../types/review";

type Row = Record<string, unknown>;

const PAGE = 1_000;

const ms = (v: unknown): number => new Date(v as string).getTime();
const msOrNull = (v: unknown): number | null => (v == null ? null : ms(v));
const msOrUndefined = (v: unknown): number | undefined => (v == null ? undefined : ms(v));
const numOrUndefined = (v: unknown): number | undefined => (v == null ? undefined : Number(v));

function check<T>(what: string, result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return (result.data ?? []) as T;
}

// ------------------------------------------------------------------
// Orders and fills
// ------------------------------------------------------------------

export function mapOrder(row: Row): Order {
  return {
    id: row.id as string,
    brokerOrderId: (row.broker_order_id as string | null) ?? undefined,
    strategyId: row.strategy_id as string,
    symbol: row.symbol as string,
    side: row.side as Order["side"],
    qty: Number(row.qty),
    filledQty: Number(row.filled_qty ?? 0),
    avgFillPrice: numOrUndefined(row.avg_fill_price),
    orderType: row.order_type as string,
    limitPrice: numOrUndefined(row.limit_price),
    status: row.status as string,
    submittedAt: ms(row.submitted_at),
    updatedAt: ms(row.updated_at),
    closedAt: msOrUndefined(row.closed_at),
    fills: [],
    runId: (row.run_id as string | null) ?? undefined,
    decisionPrice: numOrUndefined(row.decision_price),
  };
}

export function mapFill(row: Row): Fill & { runId?: string } {
  return {
    id: row.id as string,
    orderId: row.order_id as string,
    symbol: row.symbol as string,
    side: row.side as Fill["side"],
    qty: Number(row.qty),
    price: Number(row.price),
    notional: Number(row.notional),
    commission: Number(row.commission ?? 0),
    ts: ms(row.ts),
    isoTs: row.ts as string,
    runId: (row.run_id as string | null) ?? undefined,
  };
}

/** A run's orders oldest first, or (no run) the newest 500 across every run. */
export async function queryOrders(runId?: string): Promise<Order[]> {
  const base = requireSupabase().from("orders").select("*");
  const rows = runId
    ? check<Row[]>("orders", await base.eq("run_id", runId).order("submitted_at", { ascending: true }))
    : check<Row[]>("orders", await base.order("submitted_at", { ascending: false }).limit(500));
  return rows.map(mapOrder);
}

export async function queryRecentFills(limit = 500): Promise<(Fill & { runId?: string })[]> {
  const rows = check<Row[]>("fills", await requireSupabase()
    .from("fills").select("*").order("ts", { ascending: false }).limit(limit));
  return rows.map(mapFill);
}

async function readFillPages(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<Fill[]> {
  const fills: Fill[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = check<Row[]>("run fills", (await page(from, from + PAGE - 1)) as { data: Row[] | null; error: { message: string } | null });
    fills.push(...rows.map(mapFill));
    if (rows.length < PAGE) return fills;
  }
}

/**
 * Every fill one run made, oldest first. Fills from before runs were stamped
 * on fills (0016) are matched the old way: the strategy's orders since the run
 * started. Same rules as the backend's getFillsForRun.
 */
export async function queryRunFills(runId: string): Promise<Fill[]> {
  const supabase = requireSupabase();
  const { data: run, error } = await supabase
    .from("strategy_runs").select("id, strategy_id, started_at, config, execution_mode").eq("id", runId).maybeSingle();
  if (error) throw new Error(`run lookup failed: ${error.message}`);
  if (!run) throw new Error(`Run ${runId} not found`);
  const isPaper = run.execution_mode !== "live";

  const byRun = await readFillPages((from, to) => supabase
    .from("fills").select("*")
    .eq("run_id", runId).eq("is_paper", isPaper)
    .order("ts", { ascending: true }).order("id", { ascending: true })
    .range(from, to));
  if (byRun.length > 0) return byRun;

  const strategyKey = (run.config as { id?: string } | null)?.id ?? (run.strategy_id as string);
  const since = new Date((run.started_at as string | null) ?? 0).toISOString();
  return readFillPages((from, to) => supabase
    .from("fills").select("*, orders!inner(strategy_id, submitted_at)")
    .eq("orders.strategy_id", strategyKey).gte("orders.submitted_at", since).eq("is_paper", isPaper)
    .order("ts", { ascending: true }).order("id", { ascending: true })
    .range(from, to));
}

/** A run's signals, newest first. */
export async function queryRunSignals(runId: string, limit = 200): Promise<RunSignal[]> {
  const capped = Math.min(1000, Math.max(1, Math.floor(limit) || 200));
  const rows = check<Row[]>("signals", await requireSupabase()
    .from("signals").select("id, ts, symbol, direction, outcome, outcome_reason")
    .eq("run_id", runId).order("ts", { ascending: false }).limit(capped));
  return rows.map((s) => ({
    id: s.id as string,
    ts: ms(s.ts),
    symbol: (s.symbol as string | null) ?? null,
    direction: (s.direction as string | null) ?? null,
    outcome: s.outcome as string,
    reason: (s.outcome_reason as string | null) ?? null,
  }));
}

// ------------------------------------------------------------------
// Versions, proposals, comments
// ------------------------------------------------------------------

export function mapVersion(row: Row): StrategyVersion {
  const author = row.app_users as { display_name?: string } | null | undefined;
  return {
    id: row.id as string,
    strategyId: row.strategy_id as string,
    versionNumber: row.version_number as number,
    config: row.config as Record<string, unknown>,
    changeSummary: (row.change_summary as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: ms(row.created_at),
    createdByName: author?.display_name ?? null,
    algorithmVersion: (row.algorithm_version as number | null | undefined) ?? null,
  };
}

export async function queryVersions(strategyId: string): Promise<StrategyVersion[]> {
  const rows = check<Row[]>("strategy versions", await requireSupabase()
    .from("strategy_versions").select("*, app_users:created_by (display_name)")
    .eq("strategy_id", strategyId).order("version_number", { ascending: false }));
  return rows.map(mapVersion);
}

export function mapPendingApproval(row: Row): PendingApproval {
  return {
    proposalId: row.proposal_id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    requestedAt: ms(row.requested_at),
    strategyId: row.strategy_id as string,
    strategyName: row.strategy_name as string,
    strategyType: row.strategy_type as string,
    headVersionId: row.head_version_id as string,
    versionNumber: row.version_number as number,
    proposedConfig: row.proposed_config as Record<string, unknown>,
    changeSummary: (row.change_summary as string | null) ?? null,
    versionCreatedAt: ms(row.version_created_at),
    requestedById: row.requested_by_id as string,
    requestedByName: (row.requested_by_name as string | null) ?? null,
    requestedByEmail: row.requested_by_email as string,
    backtestCount: Number(row.backtest_count ?? 0),
    latestBacktestAt: msOrNull(row.latest_backtest_at),
    commentCount: Number(row.comment_count ?? 0),
    changesRequested: Boolean(row.changes_requested),
  };
}

export function mapProposalSummary(row: Row): ProposalSummary {
  return {
    proposalId: row.proposal_id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    status: row.status as ProposalStatus,
    requestedAt: ms(row.requested_at),
    updatedAt: ms(row.updated_at),
    strategyId: row.strategy_id as string,
    strategyName: row.strategy_name as string,
    strategyType: row.strategy_type as string,
    headVersionId: row.head_version_id as string,
    versionNumber: row.version_number as number,
    changeSummary: (row.change_summary as string | null) ?? null,
    requestedById: row.requested_by_id as string,
    requestedByName: (row.requested_by_name as string | null) ?? null,
    requestedByEmail: row.requested_by_email as string,
    approvedBy: (row.approved_by as string | null) ?? null,
    approvedByName: (row.approved_by_name as string | null) ?? null,
    approvedAt: msOrNull(row.approved_at),
    approvedCapitalPct: (row.approved_capital_pct as number | null) ?? null,
    rejectedBy: (row.rejected_by as string | null) ?? null,
    rejectedByName: (row.rejected_by_name as string | null) ?? null,
    rejectedAt: msOrNull(row.rejected_at),
    rejectionReason: (row.rejection_reason as string | null) ?? null,
    backtestCount: Number(row.backtest_count ?? 0),
    commentCount: Number(row.comment_count ?? 0),
    changesRequested: Boolean(row.changes_requested),
  };
}

/** The review queue, oldest request first. */
export async function queryPendingApprovals(): Promise<PendingApproval[]> {
  const rows = check<Row[]>("pending approvals", await requireSupabase()
    .from("pending_approvals").select("*").order("requested_at", { ascending: true }));
  return rows.map(mapPendingApproval);
}

/** Every proposal (optionally one status), newest first. */
export async function queryProposalSummaries(status?: ProposalStatus): Promise<ProposalSummary[]> {
  let query = requireSupabase().from("proposal_summaries").select("*").order("requested_at", { ascending: false });
  if (status) query = query.eq("status", status);
  return check<Row[]>("proposal summaries", await query).map(mapProposalSummary);
}

export function mapComment(row: Row): ProposalComment {
  const author = row.app_users as { display_name?: string } | null | undefined;
  return {
    id: row.id as string,
    proposalId: row.proposal_id as string,
    authorId: row.author_id as string,
    body: row.body as string,
    kind: row.kind as ProposalComment["kind"],
    createdAt: ms(row.created_at),
    authorName: author?.display_name ?? null,
  };
}

export async function queryComments(proposalId: string): Promise<ProposalComment[]> {
  const rows = check<Row[]>("proposal comments", await requireSupabase()
    .from("proposal_comments").select("*, app_users:author_id (display_name)")
    .eq("proposal_id", proposalId).order("created_at", { ascending: true }));
  return rows.map(mapComment);
}

// ------------------------------------------------------------------
// Backtests
// ------------------------------------------------------------------

/** Timestamps arrive as ISO strings; the UI types (and sorts, and subtracts) them as ms. */
export function mapBacktestRow(row: Row): BacktestResult {
  return {
    ...(row as unknown as BacktestResult),
    started_at: ms(row.started_at),
    completed_at: msOrUndefined(row.completed_at),
    saved_at: msOrUndefined(row.saved_at),
    error_message: (row.error_message as string | null) ?? undefined,
  };
}

const BACKTEST_LIST_COLUMNS =
  "id, strategy_id, strategy_version, config, status, started_at, completed_at, error_message, final_portfolio, metrics, event_count, created_at, saved_at";

/** Saved backtests without their equity curves, newest first. */
export async function queryBacktests(): Promise<BacktestResult[]> {
  const rows = check<Row[]>("backtests", await requireSupabase()
    .from("backtest_results").select(BACKTEST_LIST_COLUMNS).order("started_at", { ascending: false }));
  return rows.map(mapBacktestRow);
}

/** A saved backtest in full, or null when no saved row has this id. */
export async function querySavedBacktest(id: string): Promise<BacktestResult | null> {
  const { data, error } = await requireSupabase().from("backtest_results").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`backtest failed: ${error.message}`);
  return data ? mapBacktestRow(data as Row) : null;
}

// ------------------------------------------------------------------
// Governance
// ------------------------------------------------------------------

export interface ContentionRow {
  ownerId: string | null;
  ownerName: string | null;
  strategyId: string | null;
  strategyName: string | null;
  /** STRATEGY_BUDGET, CAPITAL_UNAVAILABLE, CASH_RESERVE, ORDER_COOLDOWN, ... */
  failedCheck: string;
  rejections: number;
  lastAt: number;
}

/** Risk rejections over the last `days`, grouped by member, strategy and check; most frequent first. */
export async function queryContention(days: number): Promise<ContentionRow[]> {
  const supabase = requireSupabase();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const counts = new Map<string, ContentionRow>();
  for (let offset = 0; ; offset += PAGE) {
    const rows = check<Row[]>("risk rejections", await supabase
      .from("risk_rejections").select("ts, owner_id, strategy_id, failed_check")
      .gte("ts", since).order("ts", { ascending: false }).range(offset, offset + PAGE - 1));
    for (const r of rows) {
      const key = `${r.owner_id ?? ""}|${r.strategy_id ?? ""}|${r.failed_check}`;
      const ts = ms(r.ts);
      const row = counts.get(key);
      if (row) {
        row.rejections++;
        row.lastAt = Math.max(row.lastAt, ts);
      } else {
        counts.set(key, {
          ownerId: (r.owner_id as string | null) ?? null,
          ownerName: null,
          strategyId: (r.strategy_id as string | null) ?? null,
          strategyName: null,
          failedCheck: r.failed_check as string,
          rejections: 1,
          lastAt: ts,
        });
      }
    }
    if (rows.length < PAGE) break;
  }

  const rows = [...counts.values()];
  const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter((v): v is string => !!v))];
  const strategyIds = [...new Set(rows.map((r) => r.strategyId).filter((v): v is string => !!v))];
  const [owners, strategies] = await Promise.all([
    ownerIds.length > 0
      ? supabase.from("app_users").select("id, display_name, email").in("id", ownerIds)
      : Promise.resolve({ data: [] as Row[], error: null }),
    strategyIds.length > 0
      ? supabase.from("strategies").select("id, name").in("id", strategyIds)
      : Promise.resolve({ data: [] as Row[], error: null }),
  ]);
  const ownerName = new Map(check<Row[]>("members", owners).map((u) => [u.id as string, ((u.display_name ?? u.email) as string | null) ?? null]));
  const strategyName = new Map(check<Row[]>("strategies", strategies).map((s) => [s.id as string, s.name as string]));
  for (const r of rows) {
    r.ownerName = r.ownerId ? ownerName.get(r.ownerId) ?? null : null;
    r.strategyName = r.strategyId ? strategyName.get(r.strategyId) ?? null : null;
  }
  return rows.sort((a, b) => b.rejections - a.rejections);
}
