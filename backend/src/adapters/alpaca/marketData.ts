/**
 * adapters/alpaca/marketData.ts
 *
 * Alpaca real-time market data WebSocket adapter. Connects to the Alpaca
 * data stream, subscribes to symbols, and emits normalized internal events
 * onto the EventBus. The core engine never sees raw Alpaca message shapes.
 *
 * Inputs:  List of symbols to subscribe to, EventBus instance.
 * Outputs: QuoteReceivedEvent, TradeReceivedEvent, BarReceivedEvent published
 *          to the EventBus on each incoming message.
 */

import WebSocket from "ws";
import { env } from "../../config/env";
import { normalizeQuote, normalizeTrade, normalizeBar } from "./normalizer";
import { logger } from "../../utils/logger";
import { nowMs } from "../../utils/time";
import { newId } from "../../utils/ids";
import type { EventBus } from "../../core/engine/eventBus";
import type { Symbol, ExecutionMode } from "../../types/common";

/**
 * Ping cadence. A socket that has not answered the previous ping by the next
 * one is presumed half-open and torn down, so a dead feed reconnects instead
 * of silently starving every strategy of bars.
 */
const HEARTBEAT_INTERVAL_MS = 30_000;

export class AlpacaMarketDataAdapter {
  private ws: WebSocket | null = null;
  private subscribed: Set<Symbol> = new Set();
  private isConnected = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private alive = false;

  constructor(
    private readonly eventBus: EventBus,
    private readonly mode: ExecutionMode = "paper",
  ) {}

  /**
   * Opens the WebSocket connection to the Alpaca data stream and authenticates.
   * @returns Promise that resolves when the connection is authenticated
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = env.alpacaDataStreamUrl;
      logger.info("AlpacaMarketDataAdapter: connecting", { url, mode: this.mode });
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.on("open", () => {
        logger.info("AlpacaMarketDataAdapter: WebSocket open — authenticating");
        ws.send(JSON.stringify({
          action: "auth",
          key: env.alpacaDataKey,
          secret: env.alpacaDataSecret,
        }));
      });

      ws.on("message", (data: WebSocket.Data) => {
        this._handleMessage(data, resolve, reject);
      });

      ws.on("pong", () => {
        this.alive = true;
      });

      ws.on("error", (err) => {
        logger.error("AlpacaMarketDataAdapter: WebSocket error", { message: err.message });
        reject(err);
      });

      ws.on("close", () => {
        // A replaced socket, or one closed by disconnect(), stays closed.
        if (this.ws !== ws) return;
        logger.warn("AlpacaMarketDataAdapter: WebSocket closed — scheduling reconnect");
        this.isConnected = false;
        this._stopHeartbeat();
        this._scheduleReconnect();
      });
    });
  }

  /**
   * Subscribes to real-time quotes, trades, and bars for the given symbols.
   * Sends the Alpaca subscription message over the active WebSocket.
   * @param symbols - Array of ticker symbols to subscribe to
   */
  subscribe(symbols: Symbol[]): void {
    // Always retain the desired set. Boot-time run adoption happens before the
    // socket is authenticated; dropping those symbols here leaves an adopted
    // strategy visibly running but permanently starved of market data.
    symbols.forEach((s) => this.subscribed.add(s));
    if (!this.isConnected || !this.ws) {
      logger.info("AlpacaMarketDataAdapter: subscription queued until connected", { symbols });
      return;
    }
    this.ws.send(JSON.stringify({
      action: "subscribe",
      quotes: symbols,
      trades: symbols,
      bars: symbols,
    }));
    logger.info("AlpacaMarketDataAdapter: subscribed", { symbols });
  }

  /**
   * Unsubscribes from data updates for the given symbols.
   * @param symbols - Array of ticker symbols to unsubscribe from
   */
  unsubscribe(symbols: Symbol[]): void {
    if (!this.ws) return;
    symbols.forEach((s) => this.subscribed.delete(s));
    this.ws.send(JSON.stringify({
      action: "unsubscribe",
      quotes: symbols,
      trades: symbols,
      bars: symbols,
    }));
    logger.info("AlpacaMarketDataAdapter: unsubscribed", { symbols });
  }

  /**
   * Disconnects the WebSocket and stops any pending reconnect.
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this._stopHeartbeat();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.isConnected = false;
    logger.info("AlpacaMarketDataAdapter: disconnected");
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  private _handleMessage(
    data: WebSocket.Data,
    authResolve?: (v: void) => void,
    authReject?: (err: Error) => void,
  ): void {
    let messages: unknown[];
    try {
      messages = JSON.parse(data.toString());
    } catch {
      logger.warn("AlpacaMarketDataAdapter: failed to parse message");
      return;
    }

    for (const msg of messages) {
      const m = msg as Record<string, unknown>;
      const msgType = m["T"] as string | undefined;

      switch (msgType) {
        case "connected":
          logger.debug("AlpacaMarketDataAdapter: received connected");
          break;

        case "success":
          if (m["msg"] === "authenticated") {
            this.isConnected = true;
            this._startHeartbeat();
            logger.info("AlpacaMarketDataAdapter: authenticated");
            if (this.subscribed.size > 0) {
              const symbols = [...this.subscribed];
              this.ws!.send(JSON.stringify({
                action: "subscribe",
                quotes: symbols,
                trades: symbols,
                bars: symbols,
              }));
              logger.info("AlpacaMarketDataAdapter: restored subscriptions", { symbols });
            }
            authResolve?.();
          }
          break;

        case "error":
          logger.error("AlpacaMarketDataAdapter: auth error", m);
          authReject?.(new Error(String(m["msg"] ?? "Unknown auth error")));
          break;

        case "q": {
          const quote = normalizeQuote(m as never);
          this.eventBus.publish({
            id: newId(),
            type: "QUOTE_RECEIVED",
            ts: nowMs(),
            mode: this.mode,
            payload: quote,
          });
          break;
        }

        case "t": {
          const trade = normalizeTrade(m as never);
          this.eventBus.publish({
            id: newId(),
            type: "TRADE_RECEIVED",
            ts: nowMs(),
            mode: this.mode,
            payload: trade,
          });
          break;
        }

        case "b": {
          const bar = normalizeBar(m as never, "1m");
          this.eventBus.publish({
            id: newId(),
            type: "BAR_RECEIVED",
            ts: nowMs(),
            mode: this.mode,
            payload: bar,
          });
          break;
        }

        default:
          logger.debug("AlpacaMarketDataAdapter: unhandled message type", { type: msgType });
      }
    }
  }

  private _startHeartbeat(): void {
    this._stopHeartbeat();
    this.alive = true;
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws) return;
      if (!this.alive) {
        logger.warn("AlpacaMarketDataAdapter: missed a heartbeat — reconnecting");
        ws.terminate(); // emits close, which reconnects
        return;
      }
      this.alive = false;
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

  private _scheduleReconnect(): void {
    const RECONNECT_DELAY_MS = 5_000;
    if (this.reconnectTimeout) return;
    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      logger.info("AlpacaMarketDataAdapter: reconnecting...");
      try {
        await this.connect();
      } catch (err) {
        logger.error("AlpacaMarketDataAdapter: reconnect failed", { err });
      }
    }, RECONNECT_DELAY_MS);
  }
}
