/**
 * src/index.ts
 *
 * API-only entry point. Starts the Express HTTP server without the trading
 * engine — no Alpaca connection, no orchestrator. All strategy/portfolio
 * routes that require the engine return 503 in this mode.
 *
 * Useful for iterating on API routes, controllers, and DB queries without
 * an active Alpaca connection or live market data.
 *
 * For the full trading stack use:
 *   npm run dev:paper-trading   — paper mode on port 8080 (simulated fills)
 *   npm run dev:real-trading    — real-money mode on port 8081 (requires feature gates)
 *   npm run dev                 — all three concurrently
 */

import { createApp } from "./app/index";
import { env } from "./config/env";
import { logger } from "./utils/logger";

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info(`API server started on port ${env.port} [API-ONLY — no trading engine]`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error(`Port ${env.port} is already in use. Is another server instance running?`);
  } else {
    logger.error("Server failed to start", { error: err.message });
  }
  process.exit(1);
});
