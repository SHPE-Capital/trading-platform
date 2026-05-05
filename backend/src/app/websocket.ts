/**
 * app/websocket.ts
 *
 * Attaches a WebSocketServer to the HTTP server and subscribes to the
 * EventBus to forward selected trading events to connected browser clients.
 *
 * Only events in BROADCAST_EVENT_TYPES are forwarded — high-frequency
 * market data events (QUOTE_RECEIVED, BAR_RECEIVED, etc.) are excluded
 * to avoid saturating the connection.
 *
 * Inputs:  HTTP server instance, EventBus instance.
 * Outputs: Live event stream pushed to all connected WebSocket clients.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { EventBus } from "../core/engine/eventBus";
import type { TradingEvent } from "../types/events";
import { logger } from "../utils/logger";

const BROADCAST_EVENT_TYPES = new Set([
  "ORDER_SUBMITTED",
  "ORDER_FILLED",
  "ORDER_PARTIAL_FILL",
  "ORDER_CANCELED",
  "ORDER_REJECTED",
  "ORDER_ACKNOWLEDGED",
  "ORDER_EXPIRED",
  "PORTFOLIO_UPDATED",
  "RISK_REJECTED",
  "STRATEGY_SIGNAL_CREATED",
  "STRATEGY_STARTED",
  "STRATEGY_STOPPED",
  "STRATEGY_ERROR",
  "ENGINE_STARTED",
  "ENGINE_STOPPED",
]);

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Attaches a WebSocketServer to the running HTTP server on the /ws/events
 * path and subscribes to the EventBus to broadcast selected events to
 * all connected clients.
 *
 * @param server  - The http.Server instance (shared with Express)
 * @param eventBus - The application EventBus singleton
 * @returns The WebSocketServer instance for graceful shutdown
 */
export function attachWebSocketServer(
  server: Server,
  eventBus: EventBus,
): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws/events" });

  // Track liveness per client without mutating the WebSocket object
  const aliveMap = new Map<WebSocket, boolean>();

  // ---- EventBus → WebSocket bridge ----

  const broadcastHandler = (event: TradingEvent): void => {
    if (!BROADCAST_EVENT_TYPES.has(event.type)) return;
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  };

  eventBus.onAll(broadcastHandler);

  // ---- Connection handling ----

  wss.on("connection", (ws: WebSocket) => {
    aliveMap.set(ws, true);

    ws.send(JSON.stringify({ type: "CONNECTED" }));

    ws.on("pong", () => aliveMap.set(ws, true));

    ws.on("close", () => aliveMap.delete(ws));

    ws.on("error", (err) => {
      logger.error("WebSocket client error", { err: String(err) });
    });
  });

  // ---- Ping/pong heartbeat ----
  // Clients that miss two consecutive pings (60 s) are terminated.

  const heartbeatInterval = setInterval(() => {
    for (const [ws, alive] of aliveMap) {
      if (!alive) {
        ws.terminate();
        aliveMap.delete(ws);
        continue;
      }
      aliveMap.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  // ---- Cleanup on server close ----

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
    eventBus.offAll(broadcastHandler);
    logger.info("WebSocket server closed");
  });

  logger.info("WebSocket server attached at /ws/events");
  return wss;
}
