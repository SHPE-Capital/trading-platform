jest.mock("../../config/env", () => ({ env: { alpacaPaperBaseUrl: "https://paper", alpacaLiveBaseUrl: "https://live" } }));

import { AlpacaBroker, mapAlpacaOrder } from "../../adapters/alpaca/alpacaBroker";

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } } as unknown as Response;
}

const rawOrder = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `alp-${i}`, client_order_id: `c-${i}`, symbol: "TSLA", side: "sell", qty: "1", filled_qty: "1",
  filled_avg_price: "375.12", order_type: "market", time_in_force: "day", status: "filled",
  submitted_at: new Date(Date.UTC(2026, 9, 7, 14, 0, i)).toISOString(),
  updated_at: new Date(Date.UTC(2026, 9, 7, 14, 0, i)).toISOString(),
  filled_at: new Date(Date.UTC(2026, 9, 7, 14, 0, i)).toISOString(), ...extra,
});

describe("AlpacaBroker", () => {
  it("pages orders oldest-first until a short page, dropping repeats at page edges", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => rawOrder(i));
    const page2 = [rawOrder(499), rawOrder(500), rawOrder(501)];
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(json(page1))
      .mockResolvedValueOnce(json(page2));
    const orders = await new AlpacaBroker("A", "https://paper", { key: "k", secret: "s" }, fetchImpl).listOrders(0);
    expect(orders).toHaveLength(502);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("direction=asc");
    expect(String(fetchImpl.mock.calls[1][0])).toContain(encodeURIComponent(new Date(Date.parse(rawOrder(499).submitted_at) - 1).toISOString()));
  });

  it("maps fills, treating short sales as sells", async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(json([
      { id: "act-1", order_id: "alp-1", symbol: "MU", side: "sell_short", qty: "2", price: "1069.8", transaction_time: "2026-10-07T14:00:01Z" },
    ]));
    const [f] = await new AlpacaBroker("A", "https://paper", { key: "k", secret: "s" }, fetchImpl).listFills(0);
    expect(f).toEqual({ brokerFillId: "act-1", brokerOrderId: "alp-1", symbol: "MU", side: "sell", qty: 2, price: 1069.8, ts: Date.parse("2026-10-07T14:00:01Z") });
  });

  it("reports positions with signed quantities", async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(json([
      { symbol: "AMZN", qty: "-2", avg_entry_price: "257.01", current_price: "260.1", market_value: "-520.2", unrealized_pl: "-6.18" },
    ]));
    const [p] = await new AlpacaBroker("A", "https://paper", { key: "k", secret: "s" }, fetchImpl).getPositions();
    expect(p).toMatchObject({ symbol: "AMZN", qty: -2, unrealizedPnl: -6.18 });
  });

  it("returns null for an order Alpaca does not know", async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(json({ message: "not found" }, 404));
    await expect(new AlpacaBroker("A", "https://paper", { key: "k", secret: "s" }, fetchImpl).getOrder("nope")).resolves.toBeNull();
  });

  it("closes an order at its first terminal timestamp", () => {
    const o = mapAlpacaOrder(rawOrder(1, { status: "canceled", filled_at: null, canceled_at: "2026-10-07T14:05:00Z" }));
    expect(o.closedAt).toBe(Date.parse("2026-10-07T14:05:00Z"));
  });
});
