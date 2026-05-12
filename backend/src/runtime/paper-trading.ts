/**
 * runtime/paper-trading.ts
 *
 * Paper trading entry point. Uses Alpaca paper endpoints and the
 * PaperExecutionSink (simulated fills). Boots with an empty strategy
 * registry — strategies are started via the frontend or REST API.
 *
 * Configurable env vars (optional, with defaults):
 *   INITIAL_CAPITAL=100000   Starting portfolio equity
 *   STARTUP_LEG1=           Symbol for leg 1 (e.g. SPY) — enables standalone mode
 *   STARTUP_LEG2=           Symbol for leg 2 (e.g. QQQ) — enables standalone mode
 *
 * When both STARTUP_LEG1 and STARTUP_LEG2 are set, a pairs strategy is
 * auto-registered on boot (standalone / debug mode). Otherwise the runtime
 * boots with an empty registry and waits for API-managed strategies.
 *
 * Start with: npm run dev:paper-trading  (dev)
 *             npm run start:paper-trading (prod)
 */

import { PaperExecutionSink } from "../core/execution/paperExecution";
import { bootstrapRuntime } from "./bootstrap";
import { env } from "../config/env";
import { logger } from "../utils/logger";

async function main(): Promise<void> {
  logger.info("runtime/paper-trading: starting paper trading mode");
  await bootstrapRuntime({
    mode: "paper",
    sinkFactory: (adapter) => new PaperExecutionSink(adapter),
    initialCapital: env.initialCapital,
    startupLeg1: env.startupLeg1 || undefined,
    startupLeg2: env.startupLeg2 || undefined,
  });
}

main().catch((err) => {
  logger.error("runtime/paper-trading: fatal error", { err });
  process.exit(1);
});
