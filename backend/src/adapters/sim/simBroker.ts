/**
 * adapters/sim/simBroker.ts
 *
 * IBroker for a local simulated book. The sim has no broker behind it: its
 * orders and fills are written straight to this database by the runtime, so
 * the ledger tables *are* its broker records. Reading them through IBroker lets
 * the account views and the drift check treat a sim book like an Alpaca one.
 */

import { getSupabaseClient } from "../supabase/client";
import { positionsFromFills } from "../../core/ledger/positions";
import type {
  IBroker, BrokerAccountSnapshot, BrokerPosition, BrokerOrder, BrokerFill, BrokerFee, BrokerHistoryPoint,
} from "../../core/broker/IBroker";

const READ_PAGE = 1000;

type SimFill = BrokerFill & { commission: number };

const PERIOD_MS: Record<string, number> = {
  "1D": 86_400_000, "1W": 7 * 86_400_000, "1M": 30 * 86_400_000, "3M": 90 * 86_400_000,
  "6M": 180 * 86_400_000, "1A": 365 * 86_400_000,
};

export class SimBroker implements IBroker {
  constructor(
    readonly accountId: string,
    private readonly initialCapital: number,
    /** Latest mark for a symbol (the runtime's last quote or bar), if known. */
    private readonly markPrice: (symbol: string) => number | null = () => null,
  ) {}

  private async fills(afterMs = 0): Promise<SimFill[]> {
    const out: SimFill[] = [];
    for (let from = 0; ; from += READ_PAGE) {
      const { data, error } = await getSupabaseClient()
        .from("fills")
        .select("broker_fill_id, order_id, symbol, side, qty, price, commission, ts, orders!inner(broker_order_id)")
        .eq("broker_account", this.accountId)
        .gte("ts", new Date(afterMs).toISOString())
        .order("ts", { ascending: true })
        .range(from, from + READ_PAGE - 1);
      if (error) throw new Error(`SimBroker fills read failed: ${error.message}`);
      for (const r of (data ?? []) as Record<string, unknown>[]) {
        out.push({
          brokerFillId: r.broker_fill_id as string,
          brokerOrderId: ((r.orders as { broker_order_id?: string } | null)?.broker_order_id) ?? (r.order_id as string),
          symbol: r.symbol as string,
          side: r.side as "buy" | "sell",
          qty: Number(r.qty),
          price: Number(r.price),
          commission: Number(r.commission ?? 0),
          ts: new Date(r.ts as string).getTime(),
        });
      }
      if (!data || data.length < READ_PAGE) return out;
    }
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const fills = await this.fills();
    const out: BrokerPosition[] = [];
    const lastPrice = new Map(fills.map((f) => [f.symbol, f.price]));
    for (const p of positionsFromFills(fills).values()) {
      if (p.qty === 0) continue;
      const current = this.markPrice(p.symbol) ?? lastPrice.get(p.symbol) ?? p.avgPrice;
      out.push({
        symbol: p.symbol,
        qty: p.qty,
        avgEntryPrice: p.avgPrice,
        currentPrice: current,
        marketValue: p.qty * current,
        unrealizedPnl: (current - p.avgPrice) * p.qty,
      });
    }
    return out;
  }

  async getAccount(): Promise<BrokerAccountSnapshot> {
    const fills = await this.fills();
    let cash = this.initialCapital;
    for (const f of fills) cash += (f.side === "sell" ? 1 : -1) * f.qty * f.price - f.commission;
    const positions = await this.getPositions();
    const equity = cash + positions.reduce((s, p) => s + p.marketValue, 0);
    return { accountId: this.accountId, status: "ACTIVE", cash, equity, lastEquity: equity, buyingPower: Math.max(0, cash) };
  }

  async listOrders(afterMs: number): Promise<BrokerOrder[]> {
    const out: BrokerOrder[] = [];
    for (let from = 0; ; from += READ_PAGE) {
      const { data, error } = await getSupabaseClient()
        .from("orders").select("*")
        .eq("broker_account", this.accountId)
        .gte("submitted_at", new Date(afterMs).toISOString())
        .order("submitted_at", { ascending: true })
        .range(from, from + READ_PAGE - 1);
      if (error) throw new Error(`SimBroker orders read failed: ${error.message}`);
      for (const r of (data ?? []) as Record<string, unknown>[]) out.push(rowToBrokerOrder(r));
      if (!data || data.length < READ_PAGE) return out;
    }
  }

  async getOrder(brokerOrderId: string): Promise<BrokerOrder | null> {
    const { data, error } = await getSupabaseClient()
      .from("orders").select("*").eq("broker_account", this.accountId).eq("broker_order_id", brokerOrderId).maybeSingle();
    if (error) throw new Error(`SimBroker order read failed: ${error.message}`);
    return data ? rowToBrokerOrder(data as Record<string, unknown>) : null;
  }

  listFills(afterMs: number): Promise<BrokerFill[]> {
    return this.fills(afterMs);
  }

  async listFees(): Promise<BrokerFee[]> {
    return [];
  }

  async getPortfolioHistory(period: string): Promise<BrokerHistoryPoint[]> {
    const since = Date.now() - (PERIOD_MS[period] ?? PERIOD_MS["1M"]);
    const { data, error } = await getSupabaseClient()
      .from("portfolio_snapshots").select("ts, equity, total_pnl, return_pct")
      .eq("broker_account", this.accountId)
      .gte("ts", new Date(since).toISOString())
      .order("ts", { ascending: true })
      .limit(5000);
    if (error) throw new Error(`SimBroker history read failed: ${error.message}`);
    return (data ?? []).map((r) => ({
      ts: new Date(r.ts as string).getTime(),
      equity: Number(r.equity),
      profitLoss: Number(r.total_pnl),
      profitLossPct: Number(r.return_pct),
    }));
  }
}

function rowToBrokerOrder(r: Record<string, unknown>): BrokerOrder {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    brokerOrderId: (r.broker_order_id as string | null) ?? (r.id as string),
    clientOrderId: (r.client_order_id as string | null) ?? (r.id as string),
    symbol: r.symbol as string,
    side: r.side as "buy" | "sell",
    qty: Number(r.qty),
    filledQty: Number(r.filled_qty ?? 0),
    avgFillPrice: n(r.avg_fill_price),
    orderType: r.order_type as string,
    timeInForce: r.time_in_force as string,
    limitPrice: n(r.limit_price),
    stopPrice: n(r.stop_price),
    status: r.status as string,
    submittedAt: new Date(r.submitted_at as string).getTime(),
    updatedAt: new Date(r.updated_at as string).getTime(),
    closedAt: r.closed_at ? new Date(r.closed_at as string).getTime() : null,
  };
}
