/**
 * adapters/alpaca/alpacaBroker.ts
 *
 * IBroker over Alpaca's trading REST API: account, positions, orders, FILL and
 * FEE activities, and portfolio history. Read-only — sending orders stays with
 * AlpacaOrderExecutionAdapter. Every list pages through to the end, oldest first.
 */

import { alpacaGet, type AlpacaCredentials } from "./rest";
import type {
  IBroker, BrokerAccountSnapshot, BrokerPosition, BrokerOrder, BrokerFill, BrokerFee, BrokerHistoryPoint,
} from "../../core/broker/IBroker";

type Raw = Record<string, unknown>;

const ORDERS_PAGE = 500;
const ACTIVITIES_PAGE = 100;

const num = (v: unknown): number => (v === null || v === undefined || v === "" ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const ms = (v: unknown): number => new Date(String(v)).getTime();
const msOrNull = (v: unknown): number | null => (v ? new Date(String(v)).getTime() : null);
/** Alpaca reports short sales as "sell_short"; position direction comes from qty. */
const side = (v: unknown): "buy" | "sell" => (String(v) === "buy" ? "buy" : "sell");

export function mapAlpacaOrder(o: Raw): BrokerOrder {
  return {
    brokerOrderId: String(o.id),
    clientOrderId: String(o.client_order_id ?? ""),
    symbol: String(o.symbol),
    side: side(o.side),
    qty: num(o.qty),
    filledQty: num(o.filled_qty),
    avgFillPrice: numOrNull(o.filled_avg_price),
    orderType: String(o.order_type ?? o.type ?? "market"),
    timeInForce: String(o.time_in_force ?? "day"),
    limitPrice: numOrNull(o.limit_price),
    stopPrice: numOrNull(o.stop_price),
    status: String(o.status),
    submittedAt: ms(o.submitted_at ?? o.created_at),
    updatedAt: ms(o.updated_at ?? o.submitted_at ?? o.created_at),
    closedAt: msOrNull(o.filled_at) ?? msOrNull(o.canceled_at) ?? msOrNull(o.expired_at) ?? msOrNull(o.failed_at),
  };
}

export class AlpacaBroker implements IBroker {
  constructor(
    readonly accountId: string,
    private readonly baseUrl: string,
    private readonly creds: AlpacaCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private get<T>(path: string): Promise<T> {
    return alpacaGet<T>(this.baseUrl, path, this.creds, this.fetchImpl);
  }

  async getAccount(): Promise<BrokerAccountSnapshot> {
    const a = await this.get<Raw>("/v2/account");
    return {
      accountId: String(a.account_number),
      status: String(a.status),
      cash: num(a.cash),
      equity: num(a.equity),
      lastEquity: num(a.last_equity),
      buyingPower: num(a.buying_power),
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const rows = await this.get<Raw[]>("/v2/positions");
    return rows.map((p) => ({
      symbol: String(p.symbol),
      qty: num(p.qty),
      avgEntryPrice: num(p.avg_entry_price),
      currentPrice: num(p.current_price),
      marketValue: num(p.market_value),
      unrealizedPnl: num(p.unrealized_pl),
    }));
  }

  async listOrders(afterMs: number): Promise<BrokerOrder[]> {
    const out: BrokerOrder[] = [];
    const seen = new Set<string>();
    // `after` is exclusive and orders can share a submission instant, so each
    // page starts a millisecond before the last one ended and repeats are dropped.
    let after = afterMs - 1;
    for (;;) {
      const qs = new URLSearchParams({
        status: "all", limit: String(ORDERS_PAGE), direction: "asc", nested: "false",
        after: new Date(after).toISOString(),
      });
      const page = await this.get<Raw[]>(`/v2/orders?${qs}`);
      let fresh = 0;
      for (const raw of page) {
        const order = mapAlpacaOrder(raw);
        if (seen.has(order.brokerOrderId)) continue;
        seen.add(order.brokerOrderId);
        out.push(order);
        fresh++;
      }
      if (page.length < ORDERS_PAGE || fresh === 0) return out;
      after = mapAlpacaOrder(page[page.length - 1]).submittedAt - 1;
    }
  }

  async getOrder(brokerOrderId: string): Promise<BrokerOrder | null> {
    try {
      return mapAlpacaOrder(await this.get<Raw>(`/v2/orders/${encodeURIComponent(brokerOrderId)}`));
    } catch (err) {
      if (String(err).includes("(404)")) return null;
      throw err;
    }
  }

  async listFills(afterMs: number): Promise<BrokerFill[]> {
    const rows = await this._activities("/v2/account/activities/FILL", afterMs);
    return rows.map((a) => ({
      brokerFillId: String(a.id),
      brokerOrderId: String(a.order_id),
      symbol: String(a.symbol),
      side: side(a.side),
      qty: num(a.qty),
      price: num(a.price),
      ts: ms(a.transaction_time),
    }));
  }

  async listFees(afterMs: number): Promise<BrokerFee[]> {
    const rows = await this._activities("/v2/account/activities?activity_types=FEE", afterMs);
    return rows.map((a) => ({
      id: String(a.id),
      ts: ms(a.created_at ?? a.date),
      amount: num(a.net_amount),
      description: (a.description as string | undefined) ?? null,
    }));
  }

  async getPortfolioHistory(period: string, timeframe: string): Promise<BrokerHistoryPoint[]> {
    const qs = new URLSearchParams({ period, timeframe });
    const h = await this.get<{ timestamp: number[]; equity: (number | null)[]; profit_loss: (number | null)[]; profit_loss_pct: (number | null)[] }>(
      `/v2/account/portfolio/history?${qs}`,
    );
    const points: BrokerHistoryPoint[] = [];
    h.timestamp.forEach((t, i) => {
      const equity = h.equity[i];
      if (equity === null || equity === undefined) return;
      points.push({ ts: t * 1000, equity, profitLoss: h.profit_loss[i] ?? 0, profitLossPct: h.profit_loss_pct[i] ?? 0 });
    });
    return points;
  }

  /** Pages an activities endpoint oldest-first from `afterMs`. */
  private async _activities(path: string, afterMs: number): Promise<Raw[]> {
    const out: Raw[] = [];
    let token: string | null = null;
    const join = path.includes("?") ? "&" : "?";
    for (;;) {
      const qs = new URLSearchParams({
        direction: "asc", page_size: String(ACTIVITIES_PAGE), after: new Date(afterMs - 1).toISOString(),
      });
      if (token) qs.set("page_token", token);
      const page = await this.get<Raw[]>(`${path}${join}${qs}`);
      out.push(...page);
      if (page.length < ACTIVITIES_PAGE) return out;
      token = String(page[page.length - 1].id);
    }
  }
}
