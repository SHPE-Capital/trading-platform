/**
 * src/index.ts
 *
 * Main backend entry point. Starts the Express HTTP server with WebSocket
 * support at /ws/events. Does NOT start the trading engine — use
 * runtime/live.ts for that. This entry point serves just the API layer
 * for development/testing.
 *
 * Inputs:  Environment variables via config/env.ts.
 * Outputs: Running HTTP + WebSocket server on the configured port.
 */

import http from "http";
import { createApp } from "./app/index";
import { attachWebSocketServer } from "./app/websocket";
import { EventBus } from "./core/engine/eventBus";
import { env } from "./config/env";
import { logger } from "./utils/logger";

const app = createApp();
const eventBus = new EventBus();

// Use http.createServer so WebSocket upgrade requests on /ws/events are
// handled by the ws library rather than falling through to Express (404).
const server = http.createServer(app);
attachWebSocketServer(server, eventBus);

server.listen(env.port, () => {
  logger.info(`Backend API server started on port ${env.port}`, {
    mode: env.nodeEnv,
    corsOrigin: env.corsOrigin,
  });
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error(`Port ${env.port} is already in use. Is another server instance running?`);
  } else {
    logger.error("Server failed to start", { error: err.message });
  }
  process.exit(1);
});
