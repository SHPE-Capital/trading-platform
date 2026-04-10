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

export class AlpacaMarketDataAdapter {
  private ws: WebSocket | null = null;
  private subscribed: Set<Symbol> = new Set();
  private isConnected = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;

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
      this.ws = new WebSocket(url);

      this.ws.on("open", () => {
        logger.info("AlpacaMarketDataAdapter: WebSocket open — authenticating");
        this.ws!.send(JSON.stringify({
          action: "auth",
          key: env.alpacaApiKey,
          secret: env.alpacaApiSecret,
        }));
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        this._handleMessage(data, resolve, reject);
      });

      this.ws.on("error", (err) => {
        logger.error("AlpacaMarketDataAdapter: WebSocket error", { message: err.message });
        reject(err);
      });

      this.ws.on("close", () => {
        logger.warn("AlpacaMarketDataAdapter: WebSocket closed — scheduling reconnect");
        this.isConnected = false;
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
    if (!this.isConnected || !this.ws) {
      logger.warn("AlpacaMarketDataAdapter: subscribe called before connect");
      return;
    }
    symbols.forEach((s) => this.subscribed.add(s));
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
    this.ws?.close();
    this.ws = null;
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
            logger.info("AlpacaMarketDataAdapter: authenticated");
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

  private _scheduleReconnect(): void {
    const RECONNECT_DELAY_MS = 5_000;
    this.reconnectTimeout = setTimeout(async () => {
      logger.info("AlpacaMarketDataAdapter: reconnecting...");
      try {
        await this.connect();
        if (this.subscribed.size > 0) {
          this.subscribe([...this.subscribed]);
        }
      } catch (err) {
        logger.error("AlpacaMarketDataAdapter: reconnect failed", { err });
      }
    }, RECONNECT_DELAY_MS);
  }
}
