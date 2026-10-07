/**
 * core/ledger/brokerSync.ts
 *
 * Copies what the broker executed into the ledger: orders (status, fills so
 * far), fills (one row per broker execution), and fees. Every write is keyed on
 * the broker's own ids, so a sync can be re-run — or overlap the last one —
 * without duplicating anything.
 *
 * Attribution comes from the order itself: our orders carry
 * `<runId>:<intentId>` as their client order id, and orders journaled before
 * sending already have a ledger row with their run. An order that matches
 * neither (placed by hand, or by another process) is recorded with no run, and
 * the drift check reports the position it leaves behind.
 *
 * The trade stream stays the low-latency path for the in-memory book; this is
 * the durable one. Alpaca does not replay stream events missed while
 * disconnected — this is what catches them.
 */

import { isUuid, parseClientOrderId } from "./clientOrderId";
import { TERMINAL_ORDER_STATUSES, type BrokerFee, type BrokerFill, type BrokerOrder, type IBroker } from "../broker/IBroker";
import type { OrderStatus } from "../../types/common";

/** Re-read this much before each cursor, so a late-arriving record is not missed. */
const OVERLAP_MS = 5 * 60_000;
const DEFAULT_LOOKBACK_MS = 7 * 86_400_000;

export interface SyncState {
  ordersCursor: number | null;
  fillsCursor: number | null;
  feesCursor: number | null;
}

export interface LedgerOrderRow {
  id: string;
  intent_id: string;
  strategy_id: string;
  run_id: string | null;
  broker_account: string;
  broker_order_id: string;
  client_order_id: string | null;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  filled_qty: number;
  avg_fill_price: number | null;
  order_type: string;
  limit_price: number | null;
  stop_price: number | null;
  time_in_force: string;
  status: OrderStatus;
  submitted_at: string;
  updated_at: string;
  closed_at: string | null;
  is_paper: boolean;
  source: "runtime" | "sync" | "backfill";
}

export interface LedgerFillRow {
  broker_account: string;
  broker_fill_id: string;
  order_id: string;
  run_id: string | null;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  notional: number;
  commission: number;
  ts: string;
  is_paper: boolean;
  source: "runtime" | "sync" | "backfill";
}

export interface ExistingLedgerOrder {
  id: string;
  runId: string | null;
  strategyId: string;
  brokerOrderId: string | null;
  source: "runtime" | "sync" | "backfill";
}

export interface LedgerStore {
  getSyncState(account: string): Promise<SyncState | null>;
  saveSyncState(account: string, state: SyncState & { lastSyncedAt: number; lastError: string | null }): Promise<void>;
  recordSyncError(account: string, error: string): Promise<void>;
  /** Earliest submission time among this account's orders not yet in a terminal state. */
  oldestOpenOrderMs(account: string): Promise<number | null>;
  findOrders(account: string, ids: string[], brokerOrderIds: string[]): Promise<ExistingLedgerOrder[]>;
  /** Strategy (config) id of each given run. */
  strategyIdsForRuns(runIds: string[]): Promise<Map<string, string>>;
  /** Inserts new orders; for existing ids, updates broker fields and keeps attribution. */
  upsertOrders(rows: LedgerOrderRow[]): Promise<void>;
  upsertFills(rows: LedgerFillRow[]): Promise<void>;
  upsertFees(account: string, fees: BrokerFee[]): Promise<void>;
}

export interface SyncResult {
  orders: number;
  fills: number;
  fees: number;
  /** Orders the broker has that no run sent. */
  unattributedOrders: number;
}

/** Broker order status → ledger status. */
export function mapBrokerStatus(status: string): OrderStatus {
  switch (status) {
    case "filled": return "filled";
    case "partially_filled": return "partial_fill";
    case "canceled": case "pending_cancel": case "replaced": case "pending_replace": return "canceled";
    case "expired": case "done_for_day": return "expired";
    case "rejected": case "suspended": case "stopped": return "rejected";
    case "pending_new": return "submitted";
    default: return "acknowledged";
  }
}

export interface BrokerSyncOptions {
  isPaper: boolean;
  now?: () => number;
  /** How far back a first sync reaches when there is no cursor yet. */
  defaultLookbackMs?: number;
}

export class BrokerSyncService {
  private readonly now: () => number;

  constructor(
    private readonly broker: IBroker,
    private readonly store: LedgerStore,
    private readonly options: BrokerSyncOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  get accountId(): string {
    return this.broker.accountId;
  }

  /**
   * One pass. `fromMs` overrides the cursors (a backfill passes the account's
   * creation time); otherwise it resumes from the stored cursors, reaching back
   * far enough to re-read every order still open.
   */
  async syncOnce(fromMs?: number): Promise<SyncResult> {
    const account = this.broker.accountId;
    try {
      const state = fromMs === undefined ? await this.store.getSyncState(account) : null;
      const fallback = fromMs ?? this.now() - (this.options.defaultLookbackMs ?? DEFAULT_LOOKBACK_MS);
      const openFrom = fromMs === undefined ? await this.store.oldestOpenOrderMs(account) : null;
      const ordersFrom = Math.min(state?.ordersCursor ?? fallback, openFrom ?? Infinity) - (fromMs === undefined ? OVERLAP_MS : 0);
      const fillsFrom = (state?.fillsCursor ?? fallback) - (fromMs === undefined ? OVERLAP_MS : 0);
      const feesFrom = (state?.feesCursor ?? fallback) - (fromMs === undefined ? OVERLAP_MS : 0);

      const brokerOrders = await this.broker.listOrders(ordersFrom);
      const byBrokerId = await this._syncOrders(account, brokerOrders);

      const fills = await this.broker.listFills(fillsFrom);
      await this._syncFills(account, fills, byBrokerId);

      const fees = await this.broker.listFees(feesFrom);
      await this.store.upsertFees(account, fees);

      await this.store.saveSyncState(account, {
        ordersCursor: maxOr(brokerOrders.map((o) => o.submittedAt), state?.ordersCursor ?? fromMs ?? null),
        fillsCursor: maxOr(fills.map((f) => f.ts), state?.fillsCursor ?? fromMs ?? null),
        feesCursor: maxOr(fees.map((f) => f.ts), state?.feesCursor ?? fromMs ?? null),
        lastSyncedAt: this.now(),
        lastError: null,
      });

      return {
        orders: brokerOrders.length,
        fills: fills.length,
        fees: fees.length,
        unattributedOrders: [...byBrokerId.values()].filter((o) => o.run_id === null).length,
      };
    } catch (err) {
      await this.store.recordSyncError(account, err instanceof Error ? err.message : String(err)).catch(() => {});
      throw err;
    }
  }

  /** Upserts the broker's orders; returns every ledger row touched, by broker order id. */
  private async _syncOrders(account: string, orders: BrokerOrder[]): Promise<Map<string, LedgerOrderRow>> {
    const rows = new Map<string, LedgerOrderRow>();
    if (orders.length === 0) return rows;

    const parsed = orders.map((o) => ({ o, p: parseClientOrderId(o.clientOrderId) }));
    const existing = await this.store.findOrders(
      account,
      parsed.map(({ p }) => p.intentId).filter(isUuid),
      orders.map((o) => o.brokerOrderId),
    );
    const byId = new Map(existing.map((e) => [e.id, e]));
    const byBroker = new Map(existing.filter((e) => e.brokerOrderId).map((e) => [e.brokerOrderId!, e]));
    const strategyByRun = await this.store.strategyIdsForRuns(
      [...new Set(parsed.map(({ p }) => p.runId).filter((r): r is string => !!r))],
    );

    for (const { o, p } of parsed) {
      const match = byBroker.get(o.brokerOrderId) ?? (isUuid(p.intentId) ? byId.get(p.intentId) : undefined);
      // Our orders keep the intent id as their ledger id; anything else is keyed
      // by the broker's own (UUID) order id, so re-syncing finds the same row.
      const id = match?.id ?? (isUuid(p.intentId) ? p.intentId : o.brokerOrderId);
      const runId = match?.runId ?? p.runId;
      rows.set(o.brokerOrderId, {
        id,
        intent_id: id,
        strategy_id: match?.strategyId ?? (runId ? strategyByRun.get(runId) : undefined) ?? "unattributed",
        run_id: runId,
        broker_account: account,
        broker_order_id: o.brokerOrderId,
        client_order_id: o.clientOrderId || null,
        symbol: o.symbol,
        side: o.side,
        qty: o.qty,
        filled_qty: o.filledQty,
        avg_fill_price: o.avgFillPrice,
        order_type: o.orderType,
        limit_price: o.limitPrice,
        stop_price: o.stopPrice,
        time_in_force: o.timeInForce,
        status: mapBrokerStatus(o.status),
        submitted_at: new Date(o.submittedAt).toISOString(),
        updated_at: new Date(o.updatedAt).toISOString(),
        closed_at: TERMINAL_ORDER_STATUSES.has(o.status) && o.closedAt ? new Date(o.closedAt).toISOString() : null,
        is_paper: this.options.isPaper,
        source: match?.source ?? "sync",
      });
    }
    await this.store.upsertOrders([...rows.values()]);
    return rows;
  }

  private async _syncFills(account: string, fills: BrokerFill[], known: Map<string, LedgerOrderRow>): Promise<void> {
    if (fills.length === 0) return;
    // A fill can belong to an order submitted before this pass's order window.
    const missing = [...new Set(fills.map((f) => f.brokerOrderId).filter((id) => !known.has(id)))];
    if (missing.length > 0) {
      const stored = await this.store.findOrders(account, [], missing);
      for (const e of stored) {
        known.set(e.brokerOrderId!, { id: e.id, run_id: e.runId } as LedgerOrderRow);
      }
      const stillMissing = missing.filter((id) => !known.has(id));
      const fetched = (await Promise.all(stillMissing.map((id) => this.broker.getOrder(id))))
        .filter((o): o is BrokerOrder => o !== null);
      const added = await this._syncOrders(account, fetched);
      for (const [k, v] of added) known.set(k, v);
    }

    const rows: LedgerFillRow[] = [];
    for (const f of fills) {
      const order = known.get(f.brokerOrderId);
      if (!order) continue; // the broker no longer returns the order; nothing to attach it to
      rows.push({
        broker_account: account,
        broker_fill_id: f.brokerFillId,
        order_id: order.id,
        run_id: order.run_id,
        symbol: f.symbol,
        side: f.side,
        qty: f.qty,
        price: f.price,
        notional: f.qty * f.price,
        commission: 0,
        ts: new Date(f.ts).toISOString(),
        is_paper: this.options.isPaper,
        source: "sync",
      });
    }
    await this.store.upsertFills(rows);
  }
}

function maxOr(values: number[], fallback: number | null): number | null {
  return values.length > 0 ? Math.max(...values, fallback ?? -Infinity) : fallback;
}
