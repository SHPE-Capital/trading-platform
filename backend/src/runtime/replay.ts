/**
 * runtime/replay.ts
 *
 * Replay runtime entry point. Starts the API server with a ReplayEngine
 * instance ready to load and play back recorded event logs.
 * The frontend controls playback via /api/replay/* endpoints.
 *
 * Inputs:  Environment variables; replay session selected via API.
 * Outputs: Running API server with replay engine attached.
 */

import { EventBus } from "../core/engine/eventBus";
import { ReplayEngine } from "../core/replay/replayEngine";
import { createApp } from "../app/index";
import { env } from "../config/env";
import { logger } from "../utils/logger";

async function main(): Promise<void> {
  logger.info("runtime/replay: starting replay mode");

  const eventBus = new EventBus();
  const replayEngine = new ReplayEngine(eventBus);

  // TODO: Inject replayEngine into the Express app context so controllers can use it
  // For now, start the API server — replay sessions are loaded via /api/replay/load
  const app = createApp();
  app.listen(env.port, () => {
    logger.info(`Replay API server listening on port ${env.port}`);
  });

  const shutdown = (): void => {
    logger.info("runtime/replay: shutting down");
    replayEngine.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("runtime/replay: fatal error", { err });
  process.exit(1);
});
