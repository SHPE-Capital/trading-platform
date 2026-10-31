/**
 * runtime/replay.ts
 *
 * Replay runtime entry point. Starts the API server with a ReplayEngine
 * instance ready to load and play back recorded event logs.
 * The frontend controls playback via /api/replay/* endpoints and follows it
 * over /ws/events (REPLAY_TICK plus the replayed order/portfolio events).
 *
 * Inputs:  Environment variables; replay session selected via API.
 * Outputs: Running API + WebSocket server with replay engine attached.
 */

import http from "http";
import { EventBus } from "../core/engine/eventBus";
import { ReplayEngine } from "../core/replay/replayEngine";
import { AttributionCollector } from "../core/replay/attributionCollector";
import { createApp } from "../app/index";
import { attachWebSocketServer } from "../app/websocket";
import { env } from "../config/env";
import { logger } from "../utils/logger";

async function main(): Promise<void> {
  logger.info("runtime/replay: starting replay mode");

  const eventBus = new EventBus();
  const replayEngine = new ReplayEngine(eventBus);
  const attributionCollector = new AttributionCollector(eventBus);

  const app = createApp({ replayEngine, attributionCollector });
  const server = http.createServer(app);
  attachWebSocketServer(server, eventBus);
  server.listen(env.port, () => {
    logger.info(`Replay API server listening on port ${env.port} (REST + WebSocket)`);
  });

  const shutdown = (): void => {
    logger.info("runtime/replay: shutting down");
    replayEngine.stop();
    attributionCollector.stop();
    server.close(() => process.exit(0));
    // Open WebSocket clients can hold close() open; do not wait on them forever.
    setTimeout(() => process.exit(0), 2_000).unref();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("runtime/replay: fatal error", { err });
  process.exit(1);
});
