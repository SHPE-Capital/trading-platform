/**
 * adapters/supabase/ledgerRepository.ts
 *
 * The broker ledger's storage (0016): the order journal, the sync job's store,
 * the drift check's store, and the runtime's fill writes for a sim book.
 */

import { getSupabaseClient } from "./client";
import { buildClientOrderId } from "../../core/ledger/clientOrderId";
import type {
  ExistingLedgerOrder, LedgerFillRow, LedgerOrderRow, LedgerStore, SyncState,
} from "../../core/ledger/brokerSync";
import type { DriftRow, DriftStore, RunPositionQty } from "../../core/ledger/driftCheck";
import type { OrderJournal } from "../../core/execution/journaledExecution";
import type { BrokerFee } from "../../core/broker/IBroker";
import type { Fill, Order, OrderIntent } from "../../types/orders";
import type { UUID } from "../../types/common";

const IN_CHUNK = 150;
const WRITE_CHUNK = 500;
const READ_PAGE = 1000;
const OPEN_STATUSES = ["pending", "submitted", "acknowledged", "partial_fill"];

function chunks<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());
const msOf = (v: unknown): number | null => (v ? new Date(v as string).getTime() : null);

// ------------------------------------------------------------------
// Journal — the runtime's own orders
// ------------------------------------------------------------------

export class SupabaseOrderJournal implements OrderJournal {
  constructor(private readonly brokerAccount: string, private readonly isPaper: boolean) {}

  async recordPending(intent: OrderIntent): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await getSupabaseClient().from("orders").insert({
      id: intent.id,
      intent_id: intent.id,
      strategy_id: intent.strategyId,
      run_id: intent.runId ?? null,
      broker_account: this.brokerAccount,
      client_order_id: buildClientOrderId(intent.id, intent.runId),
      signal_id: intent.signalId ?? null,
      decision_price: intent.decisionPrice ?? null,
      symbol: intent.symbol,
      side: intent.side,
      qty: intent.qty,
      filled_qty: 0,
      order_type: intent.orderType,
      limit_price: intent.limitPrice ?? null,
      stop_price: intent.stopPrice ?? null,
      time_in_force: intent.timeInForce,
      status: "pending",
      submitted_at: now,
      updated_at: now,
      meta: intent.meta ?? null,
      is_paper: this.isPaper,
      source: "runtime",
    });
    if (error) throw new Error(`journal insert failed: ${error.message}`);
  }

  async recordSendFailed(intentId: UUID, reason: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await getSupabaseClient()
      .from("orders")
      .update({ status: "rejected", updated_at: now, closed_at: now, meta: { sendError: reason } })
      .eq("id", intentId);
    if (error) throw new Error(`journal reject failed: ${error.message}`);
  }
}

/**
 * The broker accepted a journaled order. Status moves forward only from
 * "pending", so a fill that was persisted first is never overwritten.
 */
export async function markOrderSubmitted(order: Order): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("orders")
    .update({
      broker_order_id: order.brokerOrderId ?? null,
      submitted_at: new Date(order.submittedAt).toISOString(),
      updated_at: new Date(order.updatedAt).toISOString(),
    })
    .eq("id", order.id);
  if (error) throw new Error(`markOrderSubmitted failed: ${error.message}`);
  const { error: statusError } = await supabase
    .from("orders")
    .update({ status: "submitted" })
    .eq("id", order.id)
    .eq("status", "pending");
  if (statusError) throw new Error(`markOrderSubmitted status failed: ${statusError.message}`);
}

/** A fill the runtime itself produced (sim book): the sim is the broker. */
export async function insertRuntimeFill(fill: Fill, order: Order | null, brokerAccount: string, isPaper: boolean): Promise<void> {
  const { error } = await getSupabaseClient().from("fills").upsert({
    order_id: fill.orderId,
    run_id: order?.runId ?? null,
    broker_account: brokerAccount,
    broker_fill_id: `sim:${fill.id}`,
    symbol: fill.symbol,
    side: fill.side,
    qty: fill.qty,
    price: fill.price,
    notional: fill.notional,
    commission: fill.commission,
    ts: fill.isoTs || new Date(fill.ts).toISOString(),
    exchange: fill.exchange ?? null,
    is_paper: isPaper,
    source: "runtime",
  }, { onConflict: "broker_account,broker_fill_id" });
  if (error) throw new Error(`insertRuntimeFill failed: ${error.message}`);
}

// ------------------------------------------------------------------
// Sync store
// ------------------------------------------------------------------

/** Order columns the broker is authoritative for; everything else is attribution we keep. */
const BROKER_ORDER_FIELDS = [
  "broker_account", "broker_order_id", "client_order_id", "symbol", "side", "qty", "filled_qty",
  "avg_fill_price", "order_type", "limit_price", "stop_price", "time_in_force", "status",
  "submitted_at", "updated_at", "closed_at",
] as const;

export class SupabaseLedgerStore implements LedgerStore, DriftStore {
  async getSyncState(account: string): Promise<SyncState | null> {
    const { data, error } = await getSupabaseClient()
      .from("broker_sync_state").select("*").eq("broker_account", account).maybeSingle();
    if (error) throw new Error(`getSyncState failed: ${error.message}`);
    if (!data) return null;
    return { ordersCursor: msOf(data.orders_cursor), fillsCursor: msOf(data.fills_cursor), feesCursor: msOf(data.fees_cursor) };
  }

  async saveSyncState(account: string, s: SyncState & { lastSyncedAt: number; lastError: string | null }): Promise<void> {
    const { error } = await getSupabaseClient().from("broker_sync_state").upsert({
      broker_account: account,
      orders_cursor: iso(s.ordersCursor),
      fills_cursor: iso(s.fillsCursor),
      fees_cursor: iso(s.feesCursor),
      last_synced_at: iso(s.lastSyncedAt),
      last_error: s.lastError,
      updated_at: new Date().toISOString(),
    }, { onConflict: "broker_account" });
    if (error) throw new Error(`saveSyncState failed: ${error.message}`);
  }

  async recordSyncError(account: string, message: string): Promise<void> {
    await getSupabaseClient().from("broker_sync_state").upsert({
      broker_account: account, last_error: message, updated_at: new Date().toISOString(),
    }, { onConflict: "broker_account" });
  }

  async oldestOpenOrderMs(account: string): Promise<number | null> {
    const { data, error } = await getSupabaseClient()
      .from("orders").select("submitted_at")
      .eq("broker_account", account).in("status", OPEN_STATUSES)
      .order("submitted_at", { ascending: true }).limit(1);
    if (error) throw new Error(`oldestOpenOrderMs failed: ${error.message}`);
    return msOf(data?.[0]?.submitted_at);
  }

  async findOrders(account: string, ids: string[], brokerOrderIds: string[]): Promise<ExistingLedgerOrder[]> {
    const supabase = getSupabaseClient();
    const found = new Map<string, ExistingLedgerOrder>();
    const add = (rows: Record<string, unknown>[] | null) => {
      for (const r of rows ?? []) {
        found.set(r.id as string, {
          id: r.id as string,
          runId: (r.run_id as string | null) ?? null,
          strategyId: r.strategy_id as string,
          brokerOrderId: (r.broker_order_id as string | null) ?? null,
          source: (r.source as ExistingLedgerOrder["source"]) ?? "runtime",
        });
      }
    };
    const cols = "id, run_id, strategy_id, broker_order_id, source, broker_account";
    for (const part of chunks([...new Set(ids)], IN_CHUNK)) {
      const { data, error } = await supabase.from("orders").select(cols).in("id", part);
      if (error) throw new Error(`findOrders by id failed: ${error.message}`);
      add((data ?? []).filter((r) => !r.broker_account || r.broker_account === account));
    }
    for (const part of chunks([...new Set(brokerOrderIds)], IN_CHUNK)) {
      const { data, error } = await supabase.from("orders").select(cols).in("broker_order_id", part);
      if (error) throw new Error(`findOrders by broker id failed: ${error.message}`);
      add((data ?? []).filter((r) => !r.broker_account || r.broker_account === account));
    }
    return [...found.values()];
  }

  async strategyIdsForRuns(runIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const part of chunks(runIds, IN_CHUNK)) {
      const { data, error } = await getSupabaseClient().from("strategy_runs").select("id, strategy_id, config").in("id", part);
      if (error) throw new Error(`strategyIdsForRuns failed: ${error.message}`);
      for (const r of data ?? []) {
        // Orders carry the config id the strategy was built with (see getFillsForRun).
        out.set(r.id as string, ((r.config as { id?: string } | null)?.id ?? r.strategy_id) as string);
      }
    }
    return out;
  }

  async upsertOrders(rows: LedgerOrderRow[]): Promise<void> {
    const supabase = getSupabaseClient();
    for (const part of chunks(rows, IN_CHUNK)) {
      const { data: existing, error } = await supabase.from("orders").select("*").in("id", part.map((r) => r.id));
      if (error) throw new Error(`upsertOrders read failed: ${error.message}`);
      const byId = new Map((existing ?? []).map((e) => [e.id as string, e as Record<string, unknown>]));
      const merged = part.map((row) => {
        const prev = byId.get(row.id);
        if (!prev) return row;
        const next: Record<string, unknown> = { ...prev };
        for (const k of BROKER_ORDER_FIELDS) next[k] = row[k];
        // Attribution is only ever added, never cleared, by a sync.
        next.run_id = prev.run_id ?? row.run_id;
        if (!prev.strategy_id || prev.strategy_id === "unattributed") next.strategy_id = row.strategy_id;
        return next;
      });
      const { error: writeError } = await supabase.from("orders").upsert(merged, { onConflict: "id" });
      if (writeError) throw new Error(`upsertOrders write failed: ${writeError.message}`);
    }
  }

  async upsertFills(rows: LedgerFillRow[]): Promise<void> {
    for (const part of chunks(rows, WRITE_CHUNK)) {
      const { error } = await getSupabaseClient().from("fills").upsert(part, { onConflict: "broker_account,broker_fill_id" });
      if (error) throw new Error(`upsertFills failed: ${error.message}`);
    }
  }

  async upsertFees(account: string, fees: BrokerFee[]): Promise<void> {
    if (fees.length === 0) return;
    const rows = fees.map((f) => ({
      broker_account: account, id: f.id, ts: new Date(f.ts).toISOString(), amount: f.amount, description: f.description,
    }));
    const { error } = await getSupabaseClient().from("broker_fees").upsert(rows, { onConflict: "broker_account,id" });
    if (error) throw new Error(`upsertFees failed: ${error.message}`);
  }

  // ---- DriftStore ----------------------------------------------------

  async runPositions(account: string): Promise<RunPositionQty[]> {
    const out: RunPositionQty[] = [];
    for (let from = 0; ; from += READ_PAGE) {
      const { data, error } = await getSupabaseClient()
        .from("ledger_run_positions").select("run_id, symbol, qty")
        .eq("broker_account", account).range(from, from + READ_PAGE - 1);
      if (error) throw new Error(`runPositions failed: ${error.message}`);
      for (const r of data ?? []) out.push({ runId: (r.run_id as string | null) ?? null, symbol: r.symbol as string, qty: Number(r.qty) });
      if (!data || data.length < READ_PAGE) return out;
    }
  }

  async runningRunIds(runIds: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (const part of chunks(runIds, IN_CHUNK)) {
      const { data, error } = await getSupabaseClient()
        .from("strategy_runs").select("id").in("id", part).eq("status", "running");
      if (error) throw new Error(`runningRunIds failed: ${error.message}`);
      for (const r of data ?? []) out.add(r.id as string);
    }
    return out;
  }

  async replaceDrift(account: string, rows: DriftRow[], checkedAt: number): Promise<void> {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("broker_drift").delete().eq("broker_account", account);
    if (error) throw new Error(`replaceDrift clear failed: ${error.message}`);
    if (rows.length === 0) return;
    const { error: insertError } = await supabase.from("broker_drift").insert(rows.map((r) => ({
      broker_account: account,
      symbol: r.symbol,
      broker_qty: r.brokerQty,
      running_qty: r.runningQty,
      stopped_qty: r.stoppedQty,
      unattributed_qty: r.unattributedQty,
      checked_at: new Date(checkedAt).toISOString(),
    })));
    if (insertError) throw new Error(`replaceDrift insert failed: ${insertError.message}`);
  }

  async readDrift(account: string): Promise<(DriftRow & { checkedAt: number })[]> {
    const { data, error } = await getSupabaseClient().from("broker_drift").select("*").eq("broker_account", account);
    if (error) throw new Error(`readDrift failed: ${error.message}`);
    return (data ?? []).map((r) => ({
      symbol: r.symbol as string,
      brokerQty: Number(r.broker_qty),
      runningQty: Number(r.running_qty),
      stoppedQty: Number(r.stopped_qty),
      unattributedQty: Number(r.unattributed_qty),
      checkedAt: msOf(r.checked_at) ?? 0,
    }));
  }
}
