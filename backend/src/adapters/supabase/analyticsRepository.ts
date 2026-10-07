/**
 * adapters/supabase/analyticsRepository.ts
 *
 * Reads a run's ledger (fills, orders, signal outcomes, rejections, sampled
 * book) for the reports, and stores what the runtime derives from it: run
 * stats, run snapshots, signals, and run events (0016, 0017).
 */

import { getSupabaseClient } from "./client";
import { env } from "../../config/env";
import type { RunLedger, RunFill, RunOrderRow, RunSnapshotRow } from "../../core/analytics/runPerformance";
import type { OpenPosition, RunnerEvent, RunSummary, StrategyRunStats } from "../../types/analytics";
import type { StrategyRun } from "../../types/strategy";

const READ_PAGE = 1000;
const IN_CHUNK = 150;

function chunks<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await page(from, from + READ_PAGE - 1);
    if (error) throw new Error(`${what} failed: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < READ_PAGE) return out;
  }
}

/** Capital a run's returns are measured against. */
export function capitalBaseOf(run: Pick<StrategyRun, "allocatedCapital" | "config">): number {
  if (run.allocatedCapital && run.allocatedCapital > 0) return run.allocatedCapital;
  const pct = (run.config as { riskBudget?: { maxCapitalPct?: number } } | undefined)?.riskBudget?.maxCapitalPct;
  return env.initialCapital * (pct && pct > 0 ? pct : 1);
}

export async function loadRunLedger(run: StrategyRun): Promise<RunLedger> {
  const supabase = getSupabaseClient();
  const [fills, orders, signals, rejections, snapshots] = await Promise.all([
    readAll<Record<string, unknown>>((a, b) => supabase.from("fills")
      .select("order_id, symbol, side, qty, price, commission, ts").eq("run_id", run.id)
      .order("ts", { ascending: true }).order("id", { ascending: true }).range(a, b), "run fills"),
    readAll<Record<string, unknown>>((a, b) => supabase.from("orders")
      .select("id, symbol, side, status, decision_price").eq("run_id", run.id)
      .order("submitted_at", { ascending: true }).range(a, b), "run orders"),
    readAll<Record<string, unknown>>((a, b) => supabase.from("signals")
      .select("outcome").eq("run_id", run.id).range(a, b), "run signals"),
    readAll<Record<string, unknown>>((a, b) => supabase.from("risk_rejections")
      .select("failed_check").eq("run_id", run.id).range(a, b), "run rejections"),
    readAll<Record<string, unknown>>((a, b) => supabase.from("run_snapshots")
      .select("ts, realized_pnl, unrealized_pnl").eq("run_id", run.id)
      .order("ts", { ascending: true }).range(a, b), "run snapshots"),
  ]);

  const count = (rows: Record<string, unknown>[], key: string) => {
    const out: Record<string, number> = {};
    for (const r of rows) out[r[key] as string] = (out[r[key] as string] ?? 0) + 1;
    return out;
  };

  return {
    runId: run.id,
    name: (run.meta as { displayName?: string } | undefined)?.displayName ?? run.name,
    strategyType: run.strategyType,
    status: run.status,
    startedAt: run.startedAt ?? null,
    stoppedAt: run.stoppedAt ?? null,
    capitalBase: capitalBaseOf(run),
    fills: fills.map((f): RunFill => ({
      orderId: f.order_id as string,
      symbol: f.symbol as string,
      side: f.side as "buy" | "sell",
      qty: Number(f.qty),
      price: Number(f.price),
      commission: Number(f.commission ?? 0),
      ts: new Date(f.ts as string).getTime(),
    })),
    orders: orders.map((o): RunOrderRow => ({
      id: o.id as string,
      symbol: o.symbol as string,
      side: o.side as "buy" | "sell",
      status: o.status as string,
      decisionPrice: o.decision_price === null || o.decision_price === undefined ? null : Number(o.decision_price),
    })),
    signalOutcomes: count(signals, "outcome"),
    rejectionsByCheck: count(rejections, "failed_check"),
    snapshots: snapshots.map((s): RunSnapshotRow => ({
      ts: new Date(s.ts as string).getTime(),
      realizedPnl: Number(s.realized_pnl),
      unrealizedPnl: Number(s.unrealized_pnl),
    })),
  };
}

// ------------------------------------------------------------------
// Run stats
// ------------------------------------------------------------------

export async function upsertRunStats(stats: StrategyRunStats[]): Promise<void> {
  if (stats.length === 0) return;
  const { error } = await getSupabaseClient().from("strategy_run_stats").upsert(stats.map((s) => ({
    run_id: s.runId,
    signals: s.signals,
    orders: s.orders,
    filled_orders: s.filledOrders,
    fills: s.fills,
    rejections: s.rejections,
    closed_trades: s.closedTrades,
    realized_pnl: s.realizedPnl,
    unrealized_pnl: s.unrealizedPnl,
    fees: s.fees,
    open_positions: s.openPositions,
    last_fill_at: s.lastFillAt ? new Date(s.lastFillAt).toISOString() : null,
    updated_at: new Date(s.updatedAt).toISOString(),
  })), { onConflict: "run_id" });
  if (error) throw new Error(`upsertRunStats failed: ${error.message}`);
}

export function mapRunStats(r: Record<string, unknown>): StrategyRunStats {
  return {
    runId: r.run_id as string,
    signals: Number(r.signals),
    orders: Number(r.orders),
    filledOrders: Number(r.filled_orders),
    fills: Number(r.fills),
    rejections: Number(r.rejections),
    closedTrades: Number(r.closed_trades),
    realizedPnl: Number(r.realized_pnl),
    unrealizedPnl: Number(r.unrealized_pnl),
    fees: Number(r.fees),
    openPositions: (r.open_positions as OpenPosition[] | null) ?? [],
    lastFillAt: r.last_fill_at ? new Date(r.last_fill_at as string).getTime() : null,
    updatedAt: new Date(r.updated_at as string).getTime(),
  };
}

export async function getRunStats(runIds: string[]): Promise<Map<string, StrategyRunStats>> {
  const out = new Map<string, StrategyRunStats>();
  for (const part of chunks(runIds, IN_CHUNK)) {
    const { data, error } = await getSupabaseClient().from("strategy_run_stats").select("*").in("run_id", part);
    if (error) throw new Error(`getRunStats failed: ${error.message}`);
    for (const r of data ?? []) out.set(r.run_id as string, mapRunStats(r as Record<string, unknown>));
  }
  return out;
}

/** Runs on an account with fills or orders, for refreshing stats after a sync. */
export async function runIdsForOrders(orderIds: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const part of chunks(orderIds, IN_CHUNK)) {
    const { data, error } = await getSupabaseClient().from("orders").select("run_id").in("id", part).not("run_id", "is", null);
    if (error) throw new Error(`runIdsForOrders failed: ${error.message}`);
    for (const r of data ?? []) out.add(r.run_id as string);
  }
  return [...out];
}

// ------------------------------------------------------------------
// Runtime writes
// ------------------------------------------------------------------

export interface RunSnapshotInsert {
  runId: string;
  ts: number;
  realizedPnl: number;
  unrealizedPnl: number;
  grossExposure: number;
  netExposure: number;
  positions: unknown;
}

export async function insertRunSnapshots(rows: RunSnapshotInsert[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await getSupabaseClient().from("run_snapshots").insert(rows.map((r) => ({
    run_id: r.runId,
    ts: new Date(r.ts).toISOString(),
    realized_pnl: r.realizedPnl,
    unrealized_pnl: r.unrealizedPnl,
    gross_exposure: r.grossExposure,
    net_exposure: r.netExposure,
    positions: r.positions,
  })));
  if (error) throw new Error(`insertRunSnapshots failed: ${error.message}`);
}

export interface SignalRow {
  id: string;
  run_id: string | null;
  strategy_id: string;
  broker_account: string | null;
  ts: string;
  symbol: string | null;
  direction: string | null;
  payload: unknown;
  outcome: string;
  outcome_reason: string | null;
}

export async function insertSignals(rows: SignalRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await getSupabaseClient().from("signals").upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`insertSignals failed: ${error.message}`);
}

/** Moves a signal from pending to its first outcome; later outcomes for it are ignored. */
export async function setSignalOutcome(id: string, outcome: string, reason: string | null): Promise<void> {
  const { error } = await getSupabaseClient().from("signals")
    .update({ outcome, outcome_reason: reason, updated_at: new Date().toISOString() })
    .eq("id", id).eq("outcome", "pending");
  if (error) throw new Error(`setSignalOutcome failed: ${error.message}`);
}

export async function insertRunEvent(runId: string, type: string, detail: string | null = null): Promise<void> {
  const { error } = await getSupabaseClient().from("run_events").insert({ run_id: runId, type, detail });
  if (error) throw new Error(`insertRunEvent failed: ${error.message}`);
}

export async function getRunEvents(runId: string): Promise<RunnerEvent[]> {
  const { data, error } = await getSupabaseClient().from("run_events")
    .select("ts, type, detail").eq("run_id", runId).order("ts", { ascending: true }).limit(500);
  if (error) throw new Error(`getRunEvents failed: ${error.message}`);
  return (data ?? []).map((e) => ({ ts: new Date(e.ts as string).getTime(), type: e.type as string, detail: (e.detail as string | null) ?? null }));
}

// ------------------------------------------------------------------
// Strategy scope
// ------------------------------------------------------------------

export interface StrategyRunFilter {
  mode: string;
  versionId?: string;
  sandbox: "include" | "exclude" | "only";
}

export async function runSummariesFor(runs: StrategyRun[]): Promise<Omit<RunSummary, "pnl" | "trades" | "orders" | "signals">[]> {
  const versionIds = [...new Set(runs.map((r) => r.versionId).filter((v): v is string => !!v))];
  const numbers = new Map<string, number>();
  for (const part of chunks(versionIds, IN_CHUNK)) {
    const { data } = await getSupabaseClient().from("strategy_versions").select("id, version_number").in("id", part);
    for (const v of data ?? []) numbers.set(v.id as string, Number(v.version_number));
  }
  return runs.map((r) => ({
    runId: r.id,
    name: (r.meta as { displayName?: string } | undefined)?.displayName ?? r.name,
    status: r.status,
    executionMode: r.executionMode,
    runtimeOrigin: r.runtimeOrigin ?? "legacy",
    versionId: r.versionId ?? null,
    versionNumber: r.versionId ? numbers.get(r.versionId) ?? null : null,
    sandbox: !!(r.meta as { sandbox?: boolean } | undefined)?.sandbox,
    backfill: !!(r.meta as { backfill?: boolean } | undefined)?.backfill,
    startedAt: r.startedAt ?? null,
    stoppedAt: r.stoppedAt ?? null,
  }));
}

export function filterStrategyRuns(runs: StrategyRun[], f: StrategyRunFilter): StrategyRun[] {
  return runs.filter((r) => {
    if (r.executionMode !== f.mode) return false;
    if (f.versionId && r.versionId !== f.versionId) return false;
    const sandbox = !!(r.meta as { sandbox?: boolean } | undefined)?.sandbox;
    if (f.sandbox === "exclude" && sandbox) return false;
    if (f.sandbox === "only" && !sandbox) return false;
    return true;
  });
}
