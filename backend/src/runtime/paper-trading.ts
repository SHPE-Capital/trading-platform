/**
 * runtime/paper-trading.ts
 *
 * Paper trading entry point. Boots with an empty strategy registry —
 * strategies are started via the frontend or REST API.
 *
 * EXECUTION_TARGET picks where orders go:
 *   sim           (default) fills locally against market data; no broker keys
 *   alpaca-paper  sends orders to the Alpaca paper account behind
 *                 ALPACA_API_KEY — refused at boot if that account belongs to
 *                 another deployment (see config/protectedAccounts.ts)
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
  if (env.executionTarget === "alpaca-live") {
    logger.error("runtime/paper-trading: EXECUTION_TARGET=alpaca-live belongs to the real-trading runtime. Exiting.");
    process.exit(1);
  }
  logger.info(`runtime/paper-trading: starting paper trading mode [${env.executionTarget}]`);
  await bootstrapRuntime({
    mode: "paper",
    target: env.executionTarget,
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
