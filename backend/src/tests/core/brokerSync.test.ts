import { BrokerSyncService, mapBrokerStatus, type ExistingLedgerOrder, type LedgerFillRow, type LedgerOrderRow, type LedgerStore, type SyncState } from "../../core/ledger/brokerSync";
import type { BrokerFill, BrokerOrder, IBroker } from "../../core/broker/IBroker";

const ACCOUNT = "PA_TEST";
const RUN = "72afe3e1-294c-4ab7-a4f6-49e57151081b";
const INTENT_A = "e08903f4-5e1d-4c14-9e81-cc510bb25882";
const INTENT_B = "d941e817-3cae-4a8c-aadf-760f35eadab8";
const T = Date.parse("2026-10-07T14:00:00Z");

/** In-memory ledger with the Supabase store's merge semantics. */
class MemoryStore implements LedgerStore {
  orders = new Map<string, LedgerOrderRow & { signal_id?: string }>();
  fills = new Map<string, LedgerFillRow>();
  fees = new Map<string, unknown>();
  state: SyncState | null = null;
  runs = new Map<string, string>([[RUN, "cfg-mr"]]);

  async getSyncState() { return this.state; }
  async saveSyncState(_a: string, s: SyncState) { this.state = { ordersCursor: s.ordersCursor, fillsCursor: s.fillsCursor, feesCursor: s.feesCursor }; }
  async recordSyncError() {}
  async oldestOpenOrderMs() {
    const open = [...this.orders.values()].filter((o) => ["pending", "submitted", "acknowledged", "partial_fill"].includes(o.status));
    return open.length ? Math.min(...open.map((o) => Date.parse(o.submitted_at))) : null;
  }
  async findOrders(_a: string, ids: string[], brokerIds: string[]): Promise<ExistingLedgerOrder[]> {
    return [...this.orders.values()]
      .filter((o) => ids.includes(o.id) || (o.broker_order_id && brokerIds.includes(o.broker_order_id)))
      .map((o) => ({ id: o.id, runId: o.run_id, strategyId: o.strategy_id, brokerOrderId: o.broker_order_id, source: o.source }));
  }
  async strategyIdsForRuns(ids: string[]) { return new Map([...this.runs].filter(([k]) => ids.includes(k))); }
  async upsertOrders(rows: LedgerOrderRow[]) {
    for (const r of rows) {
      const prev = this.orders.get(r.id);
      this.orders.set(r.id, prev ? { ...prev, ...r, run_id: prev.run_id ?? r.run_id, strategy_id: prev.strategy_id } : r);
    }
  }
  async upsertFills(rows: LedgerFillRow[]) { for (const r of rows) this.fills.set(r.broker_fill_id, r); }
  async upsertFees(_a: string, fees: { id: string }[]) { for (const f of fees) this.fees.set(f.id, f); }
}

function order(overrides: Partial<BrokerOrder>): BrokerOrder {
  return {
    brokerOrderId: "alp-1", clientOrderId: `${RUN}:${INTENT_A}`, symbol: "TSLA", side: "sell", qty: 1, filledQty: 1,
    avgFillPrice: 375.12, orderType: "market", timeInForce: "day", limitPrice: null, stopPrice: null,
    status: "filled", submittedAt: T, updatedAt: T + 1000, closedAt: T + 1000, ...overrides,
  };
}

function fill(overrides: Partial<BrokerFill>): BrokerFill {
  return { brokerFillId: "act-1", brokerOrderId: "alp-1", symbol: "TSLA", side: "sell", qty: 1, price: 375.12, ts: T + 1000, ...overrides };
}

function broker(orders: BrokerOrder[], fills: BrokerFill[], extra: BrokerOrder[] = []): IBroker {
  return {
    accountId: ACCOUNT,
    getAccount: jest.fn(),
    getPositions: jest.fn(async () => []),
    listOrders: jest.fn(async () => orders),
    getOrder: jest.fn(async (id: string) => extra.find((o) => o.brokerOrderId === id) ?? null),
    listFills: jest.fn(async () => fills),
    listFees: jest.fn(async () => [{ id: "fee-1", ts: T, amount: -0.01, description: "TAF" }]),
    getPortfolioHistory: jest.fn(),
  };
}

describe("BrokerSyncService", () => {
  it("attributes an order to the run named in its client order id", async () => {
    const store = new MemoryStore();
    await new BrokerSyncService(broker([order({})], [fill({})]), store, { isPaper: true }).syncOnce(T - 1);
    const row = store.orders.get(INTENT_A)!;
    expect(row).toMatchObject({ run_id: RUN, strategy_id: "cfg-mr", broker_account: ACCOUNT, status: "filled", filled_qty: 1, source: "sync" });
    expect(store.fills.get("act-1")).toMatchObject({ order_id: INTENT_A, run_id: RUN, qty: 1, price: 375.12, notional: 375.12 });
  });

  it("is idempotent: syncing the same history twice writes the same rows once", async () => {
    const store = new MemoryStore();
    const b = broker([order({}), order({ brokerOrderId: "alp-2", clientOrderId: INTENT_B, symbol: "AAPL" })],
      [fill({}), fill({ brokerFillId: "act-2", brokerOrderId: "alp-2", symbol: "AAPL" })]);
    const sync = new BrokerSyncService(b, store, { isPaper: true });
    await sync.syncOnce(T - 1);
    const snapshot = JSON.stringify([...store.orders.values(), ...store.fills.values()]);
    await sync.syncOnce(T - 1);
    expect(store.orders.size).toBe(2);
    expect(store.fills.size).toBe(2);
    expect(store.fees.size).toBe(1);
    expect(JSON.stringify([...store.orders.values(), ...store.fills.values()])).toBe(snapshot);
  });

  it("keeps attribution a journaled order already has and only updates broker fields", async () => {
    const store = new MemoryStore();
    store.orders.set(INTENT_A, {
      ...({} as LedgerOrderRow), id: INTENT_A, intent_id: INTENT_A, strategy_id: "cfg-mr", run_id: RUN,
      broker_account: ACCOUNT, broker_order_id: null as unknown as string, client_order_id: `${RUN}:${INTENT_A}`,
      status: "pending", submitted_at: new Date(T).toISOString(), source: "runtime", signal_id: "sig-1",
    });
    await new BrokerSyncService(broker([order({})], []), store, { isPaper: true }).syncOnce(T - 1);
    expect(store.orders.get(INTENT_A)).toMatchObject({ run_id: RUN, source: "runtime", signal_id: "sig-1", status: "filled", broker_order_id: "alp-1" });
  });

  it("records an order no run sent, keyed by its broker id, and counts it", async () => {
    const store = new MemoryStore();
    const result = await new BrokerSyncService(
      broker([order({ brokerOrderId: "aaaaaaaa-1111-4111-8111-111111111111", clientOrderId: "web-order-7" })], []),
      store, { isPaper: true },
    ).syncOnce(T - 1);
    const row = store.orders.get("aaaaaaaa-1111-4111-8111-111111111111")!;
    expect(row).toMatchObject({ run_id: null, strategy_id: "unattributed", client_order_id: "web-order-7" });
    expect(result.unattributedOrders).toBe(1);
  });

  it("fetches an older order a fill belongs to when it is outside the order window", async () => {
    const store = new MemoryStore();
    const older = order({ brokerOrderId: "alp-old", clientOrderId: `${RUN}:${INTENT_B}`, submittedAt: T - 86_400_000 });
    const b = broker([], [fill({ brokerFillId: "act-9", brokerOrderId: "alp-old" })], [older]);
    await new BrokerSyncService(b, store, { isPaper: true }).syncOnce(T - 1);
    expect(b.getOrder).toHaveBeenCalledWith("alp-old");
    expect(store.fills.get("act-9")).toMatchObject({ order_id: INTENT_B, run_id: RUN });
  });

  it("resumes from its cursors, reaching back to the oldest order still open", async () => {
    const store = new MemoryStore();
    const b = broker([order({ status: "new", filledQty: 0, closedAt: null })], []);
    const sync = new BrokerSyncService(b, store, { isPaper: true, now: () => T + 3_600_000 });
    await sync.syncOnce(T - 1);
    (b.listOrders as jest.Mock).mockClear();
    await sync.syncOnce();
    const after = (b.listOrders as jest.Mock).mock.calls[0][0];
    expect(after).toBeLessThanOrEqual(T);
  });

  it("maps broker statuses onto ledger statuses", () => {
    expect(mapBrokerStatus("partially_filled")).toBe("partial_fill");
    expect(mapBrokerStatus("new")).toBe("acknowledged");
    expect(mapBrokerStatus("replaced")).toBe("canceled");
    expect(mapBrokerStatus("done_for_day")).toBe("expired");
  });
});
