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
import { nowMs } from "../../utils/time";
import { newId } from "../../utils/ids";
import { buildClientOrderId, parseClientOrderId } from "../../core/ledger/clientOrderId";
import type { EventBus } from "../../core/engine/eventBus";
import type { OrderIntent, Order, Fill } from "../../types/orders";
import type { ExecutionMode } from "../../types/common";

/** Trade stream reconnect backoff: 1 s, doubling, capped at 30 s. */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/**
 * Ping cadence for the trade stream. A socket that has not answered the
 * previous ping by the next one is presumed half-open (host sleep, NAT drop)
 * and is torn down so the reconnect path takes over.
 */
const HEARTBEAT_INTERVAL_MS = 30_000;
/** Orders whose stream-reported fills are remembered for reconciliation. */
const STREAM_FILLS_CAPACITY = 10_000;

export class AlpacaOrderExecutionAdapter {
  private tradeStreamWs: WebSocket | null = null;
  private isConnected = false;
  /** Cleared by disconnect(): any other close is unexpected and reconnects. */
  private keepTradeStreamOpen = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private tradeStreamAlive = false;
  private readonly reconnectHandlers: Array<() => void> = [];
  /** Cumulative filled qty seen so far per orderId — used to derive per-event
   * delta qty if `data.qty` is absent on a trade_updates payload. */
  private lastFilledCumulative: Map<string, number> = new Map();
  /**
   * Cumulative filled qty per order as the stream reported it, kept after the
   * order is terminal (bounded, oldest evicted). Reconciliation consults it so
   * a fill the stream already delivered is never published twice.
   */
  private readonly streamFilledQty: Map<string, number> = new Map();

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
      // Alpaca echoes this value on trade_updates. Internal reservations and
      // persistence are keyed by the intent id, so omitting it makes fills
      // impossible to correlate with the submitted order. Prefixed with the run
      // id, so Alpaca's own records say which run sent each order.
      client_order_id: buildClientOrderId(intent.id, intent.runId),
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
   *
   * Without this stream the engine never learns about fills, so it is kept
   * open: any close other than disconnect() reconnects with backoff, and a
   * ping heartbeat catches half-open sockets that never report a close.
   * @returns Promise that resolves when the stream is authenticated
   */
  connectTradeStream(): Promise<void> {
    this.keepTradeStreamOpen = true;
    return new Promise((resolve, reject) => {
      const url = this.mode === "live" ? env.alpacaLiveStreamUrl : env.alpacaPaperStreamUrl;
      logger.info("AlpacaOrderExecution: connecting trade stream", { url });
      const ws = new WebSocket(url);
      this.tradeStreamWs = ws;

      ws.on("open", () => {
        // Alpaca deprecated {action: "authenticate", data: {key_id, secret_key}}
        // for this flat form; replies are the same either way.
        ws.send(JSON.stringify({ action: "auth", key: env.alpacaApiKey, secret: env.alpacaApiSecret }));
      });

      ws.on("message", (data) => {
        this._handleTradeStreamMessage(data, resolve, reject);
      });

      ws.on("pong", () => {
        this.tradeStreamAlive = true;
      });

      ws.on("error", (err) => {
        logger.error("AlpacaOrderExecution: trade stream error", { message: err.message });
        reject(err);
      });

      ws.on("close", () => {
        logger.warn("AlpacaOrderExecution: trade stream closed");
        if (this.tradeStreamWs !== ws) return; // an older socket, already replaced
        this.isConnected = false;
        this._stopHeartbeat();
        if (this.keepTradeStreamOpen) this._scheduleReconnect();
      });
    });
  }

  /**
   * Disconnects the trade update WebSocket stream.
   */
  disconnect(): void {
    this.keepTradeStreamOpen = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._stopHeartbeat();
    this.tradeStreamWs?.close();
    this.tradeStreamWs = null;
    this.isConnected = false;
  }

  /**
   * Registers a callback for each time the trade stream comes back after an
   * unexpected close (not the first connect). Fills that happened while it was
   * down are not replayed by Alpaca; pair this with reconcileOrders().
   */
  onReconnect(handler: () => void): void {
    this.reconnectHandlers.push(handler);
  }

  /**
   * Publishes whatever the stream missed for orders the engine still believes
   * are open. Each is read back over REST; a fill not yet seen, or a terminal
   * state, is published exactly as the stream would have delivered it.
   * @returns number of events published
   */
  async reconcileOrders(orders: Array<Pick<Order, "id" | "filledQty" | "clientOrderId">>): Promise<number> {
    let published = 0;
    for (const order of orders) {
      let raw: Record<string, unknown>;
      try {
        raw = await this._fetchOrderByClientId(order.clientOrderId ?? order.id);
      } catch (err) {
        logger.warn("AlpacaOrderExecution: could not read order back for reconciliation", {
          orderId: order.id, err: String(err),
        });
        continue;
      }
      const status = String(raw["status"] ?? "");
      const filledQty = parseFloat(String(raw["filled_qty"] ?? 0));
      const knownQty = Math.max(order.filledQty, this.streamFilledQty.get(order.id) ?? 0);
      const missedQty = filledQty - knownQty;
      if (missedQty > 1e-9) {
        this._handleTradeUpdate({
          event: status === "filled" ? "fill" : "partial_fill",
          order: raw,
          qty: String(missedQty),
          price: raw["filled_avg_price"],
        });
        published++;
      }
      if (status === "canceled" || status === "expired" || status === "rejected") {
        this._handleTradeUpdate({ event: status, order: raw });
        published++;
      }
    }
    logger.info("AlpacaOrderExecution: reconciled orders after trade stream gap", {
      checked: orders.length, published,
    });
    return published;
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
      const status = (msg["data"] as Record<string, unknown>)?.["status"];
      if (status === "authorized") {
        logger.info("AlpacaOrderExecution: trade stream authenticated");
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.tradeStreamWs!.send(JSON.stringify({
          action: "listen",
          data: { streams: ["trade_updates"] },
        }));
        this._startHeartbeat();
        authResolve?.();
      } else {
        authReject?.(new Error("Alpaca trade stream auth failed"));
        // Close so the reconnect path retries rather than idling unauthenticated.
        this.tradeStreamWs?.close();
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
    const clientOrderId = order["client_order_id"] as string | undefined;
    const orderId = clientOrderId ? parseClientOrderId(clientOrderId).intentId : newId();

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
        this._rememberStreamFill(orderId, newCumulative);

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

  private _rememberStreamFill(orderId: string, cumulative: number): void {
    this.streamFilledQty.delete(orderId); // re-insert as newest
    this.streamFilledQty.set(orderId, cumulative);
    if (this.streamFilledQty.size > STREAM_FILLS_CAPACITY) {
      const oldest = this.streamFilledQty.keys().next().value;
      if (oldest !== undefined) this.streamFilledQty.delete(oldest);
    }
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delayMs = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempts);
    this.reconnectAttempts++;
    logger.info("AlpacaOrderExecution: trade stream reconnect scheduled", {
      delayMs, attempt: this.reconnectAttempts,
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectTradeStream().then(
        () => {
          logger.info("AlpacaOrderExecution: trade stream reconnected");
          for (const handler of this.reconnectHandlers) handler();
        },
        // A failed attempt closes its socket, which schedules the next one.
        (err) => logger.error("AlpacaOrderExecution: trade stream reconnect failed", { err: String(err) }),
      );
    }, delayMs);
  }

  private _startHeartbeat(): void {
    this._stopHeartbeat();
    this.tradeStreamAlive = true;
    this.heartbeatTimer = setInterval(() => {
      const ws = this.tradeStreamWs;
      if (!ws) return;
      if (!this.tradeStreamAlive) {
        logger.warn("AlpacaOrderExecution: trade stream missed a heartbeat — reconnecting");
        ws.terminate(); // emits close, which reconnects
        return;
      }
      this.tradeStreamAlive = false;
      ws.ping();
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async _fetchOrderByClientId(clientOrderId: string): Promise<Record<string, unknown>> {
    const baseUrl = this.mode === "live" ? env.alpacaLiveBaseUrl : env.alpacaPaperBaseUrl;
    const url = `${baseUrl}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`;
    const response = await fetch(url, {
      headers: {
        "APCA-API-KEY-ID": env.alpacaApiKey,
        "APCA-API-SECRET-KEY": env.alpacaApiSecret,
      },
    });
    if (!response.ok) {
      throw new Error(`Alpaca order lookup failed (${response.status}): ${await response.text()}`);
    }
    return (await response.json()) as Record<string, unknown>;
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
      runId: intent.runId,
      signalId: intent.signalId,
      clientOrderId: (raw["client_order_id"] as string | undefined) ?? buildClientOrderId(intent.id, intent.runId),
      decisionPrice: intent.decisionPrice,
    };
  }
}
