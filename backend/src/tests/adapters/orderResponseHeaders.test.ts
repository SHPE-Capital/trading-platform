/**
 * tests/adapters/orderResponseHeaders.test.ts
 *
 * Response-header timing: the Alpaca order adapter reports when a submission's
 * HTTP headers arrive (fetch resolved), before the body is read, and the probe
 * turns that into order.submit_to_response_headers_ns.
 */

import { EventBus } from "../../core/engine/eventBus";
import { AlpacaOrderExecutionAdapter } from "../../adapters/alpaca/orderExecution";
import { LatencyProbe } from "../../core/telemetry/latencyProbe";
import type { OrderIntent } from "../../types/orders";

const intent = { id: "11111111-1111-4111-8111-111111111111", strategyId: "s", symbol: "SPY", side: "buy", qty: 1, orderType: "market", timeInForce: "day", ts: 1 } as OrderIntent;

afterEach(() => jest.restoreAllMocks());

it("reports response headers between the request and the parsed body", async () => {
  const order: string[] = [];
  jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
    order.push("fetch");
    return {
      ok: true,
      status: 200,
      json: async () => { order.push("body"); return { id: "broker-1", client_order_id: intent.id }; },
      text: async () => "",
    } as unknown as Response;
  });
  const seen: Array<[string, number]> = [];
  const adapter = new AlpacaOrderExecutionAdapter(new EventBus(), "paper", {
    onResponseHeaders: (id, _ns, status) => { order.push("headers"); seen.push([id, status]); },
  });
  const result = await adapter.submitOrder(intent);
  expect(result.brokerOrderId).toBe("broker-1");
  expect(order).toEqual(["fetch", "headers", "body"]);
  expect(seen).toEqual([[intent.id, 200]]);
});

it("is reported for failed submissions too", async () => {
  jest.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 403, text: async () => "forbidden" } as unknown as Response);
  const statuses: number[] = [];
  const adapter = new AlpacaOrderExecutionAdapter(new EventBus(), "paper", { onResponseHeaders: (_id, _ns, s) => statuses.push(s) });
  await expect(adapter.submitOrder(intent)).rejects.toThrow(/403/);
  expect(statuses).toEqual([403]);
});

it("the probe measures submit start → headers", () => {
  const probe = new LatencyProbe({ runId: "t" });
  probe.intentReady(intent.id, { id: "1:1", rxMonoNs: 0 }, 1n);
  probe.submitStart(intent.id, 100n);
  probe.responseHeaders(intent.id, 4_100n);
  probe.submitEnd(intent.id, 5_000n, "ok");
  expect(probe.histogram("order.submit_to_response_headers_ns")!.max).toBe(4_000);
  expect(probe.histogram("order.submit_to_response_ns")!.max).toBe(4_900);
});
