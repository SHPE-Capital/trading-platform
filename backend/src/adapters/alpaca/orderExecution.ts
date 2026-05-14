/**
 * adapters/alpaca/orderExecution.ts
 *
 * Alpaca order execution adapter. Submits orders to the Alpaca REST API
 * (paper or live) and listens for order/trade update events via the
 * Alpaca trade stream WebSocket.
 *
 * Inputs:  OrderIntent validated by the risk engine.
 * Outputs: Publishes ORDER_SUBMITTED, ORDER_FILLED, ORDER_CANCELED, etc.
 *          events to the EventBus when Alpaca responds.
 */

import WebSocket from "ws";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { nowMs, isoToMs } from "../../utils/time";
import { newId } from "../../utils/ids";
import type { EventBus } from "../../core/engine/eventBus";
import type { OrderIntent, Order, Fill } from "../../types/orders";
import type { ExecutionMode } from "../../types/common";

export class AlpacaOrderExecutionAdapter {
  private tradeStreamWs: WebSocket | null = null;
  private isConnected = false;
  /** Cumulative filled qty seen so far per orderId — used to derive per-event
   * delta qty if `data.qty` is absent on a trade_updates payload. */
  private lastFilledCumulative: Map<string, number> = new Map();

  constructor(
    private readonly eventBus: EventBus,
    private readonly mode: ExecutionMode = "paper",
  ) {}

  /**
   * Submits an order intent to the Alpaca REST API.
   * Publishes an ORDER_SUBMITTED event on success.
   * @param intent - Validated OrderIntent from the risk engine
   * @returns The submitted Order object
   */
  async submitOrder(intent: OrderIntent): Promise<Order> {
    const baseUrl = this.mode === "live" ? env.alpacaLiveBaseUrl : env.alpacaPaperBaseUrl;
    const url = `${baseUrl}/v2/orders`;

    const body: Record<string, unknown> = {
      symbol: intent.symbol,
      qty: String(intent.qty),
      side: intent.side,
      type: intent.orderType,
      time_in_force: intent.timeInForce,
    };
    if (intent.limitPrice !== undefined) body["limit_price"] = String(intent.limitPrice);
    if (intent.stopPrice !== undefined) body["stop_price"] = String(intent.stopPrice);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "APCA-API-KEY-ID": env.alpacaApiKey,
        "APCA-API-SECRET-KEY": env.alpacaApiSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Alpaca order submission failed (${response.status}): ${errorText}`);
    }

    const raw = (await response.json()) as Record<string, unknown>;
    const order = this._rawToOrder(raw, intent);

    this.eventBus.publish({
      id: newId(),
      type: "ORDER_SUBMITTED",
      ts: nowMs(),
      mode: this.mode,
      payload: order,
    });

    logger.info("AlpacaOrderExecution: order submitted", {
      orderId: order.id,
      brokerOrderId: order.brokerOrderId,
      symbol: order.symbol,
    });

    return order;
  }

  /**
   * Cancels an existing order by its broker order ID.
   * @param brokerOrderId - Alpaca order ID to cancel
   */
  async cancelOrder(brokerOrderId: string): Promise<void> {
    const baseUrl = this.mode === "live" ? env.alpacaLiveBaseUrl : env.alpacaPaperBaseUrl;
    const url = `${baseUrl}/v2/orders/${brokerOrderId}`;

    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        "APCA-API-KEY-ID": env.alpacaApiKey,
        "APCA-API-SECRET-KEY": env.alpacaApiSecret,
      },
    });

    if (!response.ok && response.status !== 204) {
      const errorText = await response.text();
      throw new Error(`Alpaca cancel order failed (${response.status}): ${errorText}`);
    }

    logger.info("AlpacaOrderExecution: order cancel requested", { brokerOrderId });
  }

  /**
   * Connects to the Alpaca trade update WebSocket stream.
   * Publishes fill, cancel, and rejection events to the EventBus.
   * @returns Promise that resolves when the stream is authenticated
   */
  connectTradeStream(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.mode === "live" ? env.alpacaLiveStreamUrl : env.alpacaPaperStreamUrl;
      logger.info("AlpacaOrderExecution: connecting trade stream", { url });
      this.tradeStreamWs = new WebSocket(url);

      this.tradeStreamWs.on("open", () => {
        this.tradeStreamWs!.send(JSON.stringify({
          action: "authenticate",
          data: { key_id: env.alpacaApiKey, secret_key: env.alpacaApiSecret },
        }));
      });

      this.tradeStreamWs.on("message", (data) => {
        this._handleTradeStreamMessage(data, resolve, reject);
      });

      this.tradeStreamWs.on("error", (err) => {
        logger.error("AlpacaOrderExecution: trade stream error", { message: err.message });
        reject(err);
      });

      this.tradeStreamWs.on("close", () => {
        logger.warn("AlpacaOrderExecution: trade stream closed");
        this.isConnected = false;
      });
    });
  }

  /**
   * Disconnects the trade update WebSocket stream.
   */
  disconnect(): void {
    this.tradeStreamWs?.close();
    this.tradeStreamWs = null;
    this.isConnected = false;
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  private _handleTradeStreamMessage(
    data: WebSocket.Data,
    authResolve?: (v: void) => void,
    authReject?: (err: Error) => void,
  ): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    const stream = msg["stream"] as string | undefined;

    if (stream === "authorization") {
      const action = (msg["data"] as Record<string, unknown>)?.["action"];
      if (action === "authenticate") {
        this.isConnected = true;
        this.tradeStreamWs!.send(JSON.stringify({
          action: "listen",
          data: { streams: ["trade_updates"] },
        }));
        authResolve?.();
      } else {
        authReject?.(new Error("Alpaca trade stream auth failed"));
      }
      return;
    }

    if (stream === "trade_updates") {
      this._handleTradeUpdate((msg["data"] as Record<string, unknown>) ?? {});
    }
  }

  private _handleTradeUpdate(data: Record<string, unknown>): void {
    const event = data["event"] as string | undefined;
    const order = data["order"] as Record<string, unknown> | undefined;
    if (!event || !order) return;

    const ts = nowMs();
    const orderId = order["client_order_id"] as string ?? newId();
    const brokerOrderId = order["id"] as string;

    switch (event) {
      case "fill":
      case "partial_fill": {
        // Alpaca trade_updates payload: `data.qty` is the qty of THIS event;
        // `order.filled_qty` is the cumulative qty across all fills for the
        // order. Use the per-event delta — using cumulative double-counted
        // qty on subsequent partial fills. As a defensive fallback, if the
        // delta isn't present, derive it from cumulative - already-recorded.
        const deltaQtyRaw = data["qty"];
        const eventDeltaQty = deltaQtyRaw !== undefined ? parseFloat(String(deltaQtyRaw)) : NaN;
        const cumulativeFilled = parseFloat(String(order["filled_qty"] ?? 0));
        const prevCumulative = this.lastFilledCumulative.get(orderId) ?? 0;
        const fillQty = Number.isFinite(eventDeltaQty) && eventDeltaQty > 0
          ? eventDeltaQty
          : Math.max(0, cumulativeFilled - prevCumulative);
        // Update the running cumulative for this orderId so a later partial
        // fill can derive its delta even if `data.qty` is missing.
        const newCumulative = Math.max(prevCumulative, cumulativeFilled, prevCumulative + fillQty);
        this.lastFilledCumulative.set(orderId, newCumulative);

        const fill: Fill = {
          id: newId(),
          orderId,
          symbol: order["symbol"] as string,
          side: order["side"] as "buy" | "sell",
          qty: fillQty,
          price: parseFloat(String(data["price"] ?? order["filled_avg_price"] ?? 0)),
          notional: 0,
          commission: 0,
          ts,
          isoTs: order["updated_at"] as string ?? new Date().toISOString(),
        };
        fill.notional = fill.qty * fill.price;

        // remainingQty must subtract the CUMULATIVE filled, not just this
        // event's delta. Previously: `orderQty - fill.qty` produced wildly
        // wrong residuals on the 2nd+ partial fill (e.g. order=10, partial
        // 1 delta=6, partial 2 delta=2 → reported remaining=8 instead of 2).
        const orderTotalQty = parseFloat(String(order["qty"] ?? 0));
        const remainingQty = Math.max(0, orderTotalQty - newCumulative);

        this.eventBus.publish({
          id: newId(),
          type: event === "fill" ? "ORDER_FILLED" : "ORDER_PARTIAL_FILL",
          ts,
          mode: this.mode,
          orderId,
          fill,
          ...(event === "partial_fill" ? { remainingQty } : {}),
        } as never);

        // Terminal event: clear per-order tracking to avoid leaking entries
        // across order ids. Partial fills keep the entry alive so the next
        // delta can be derived.
        if (event === "fill") {
          this.lastFilledCumulative.delete(orderId);
        }
        break;
      }

      case "canceled":
      case "expired":
        // Terminal: drop per-order tracking.
        this.lastFilledCumulative.delete(orderId);
        this.eventBus.publish({
          id: newId(),
          type: event === "canceled" ? "ORDER_CANCELED" : "ORDER_EXPIRED",
          ts,
          mode: this.mode,
          orderId,
        } as never);
        break;

      case "rejected":
        // Terminal: drop per-order tracking.
        this.lastFilledCumulative.delete(orderId);
        this.eventBus.publish({
          id: newId(),
          type: "ORDER_REJECTED",
          ts,
          mode: this.mode,
          orderId,
          reason: String(data["reason"] ?? "Unknown rejection reason"),
        } as never);
        break;

      default:
        logger.debug("AlpacaOrderExecution: unhandled trade update event", { event });
    }
  }

  /**
   * Test/diagnostics: returns the number of orderIds being tracked for
   * cumulative fill derivation. A growing value across many terminal-state
   * orders would indicate a leak.
   */
  trackedOrderCount(): number {
    return this.lastFilledCumulative.size;
  }

  private _rawToOrder(raw: Record<string, unknown>, intent: OrderIntent): Order {
    const ts = nowMs();
    return {
      id: intent.id,
      brokerOrderId: raw["id"] as string,
      intentId: intent.id,
      strategyId: intent.strategyId,
      symbol: intent.symbol,
      side: intent.side,
      qty: intent.qty,
      filledQty: 0,
      orderType: intent.orderType,
      limitPrice: intent.limitPrice,
      stopPrice: intent.stopPrice,
      timeInForce: intent.timeInForce,
      status: "submitted",
      submittedAt: ts,
      updatedAt: ts,
      fills: [],
      meta: intent.meta,
    };
  }
}
