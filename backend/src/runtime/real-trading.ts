/**
 * runtime/real-trading.ts
 *
 * Real-money trading entry point. Uses Alpaca live endpoints and LiveExecutionSink.
 * Boots with an empty strategy registry — strategies are started via the
 * frontend or REST API.
 *
 * DUAL FEATURE GATE — both of the following must be explicitly set before
 * this runtime will start:
 *   ALPACA_TRADING_MODE=live
 *   ENABLE_LIVE_TRADING=true
 *
 * Either gate failing causes an immediate logged exit before any connection
 * to Alpaca live systems is opened. This prevents accidental real-money
 * trading from a misconfigured environment.
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
 * Start with: npm run dev:real-trading  (dev)
 *             npm run start:real-trading (prod)
 */

import { LiveExecutionSink } from "../core/execution/liveExecution";
import { bootstrapRuntime } from "./bootstrap";
import { env } from "../config/env";
import { logger } from "../utils/logger";

async function main(): Promise<void> {
  if (env.alpacaTradingMode !== "live") {
    logger.error(
      "runtime/real-trading: ALPACA_TRADING_MODE must be 'live' to run this runtime. " +
      `Current value: '${env.alpacaTradingMode}'. Exiting.`,
    );
    process.exit(1);
  }
  if (!env.enableLiveTrading) {
    logger.error(
      "runtime/real-trading: ENABLE_LIVE_TRADING must be 'true' to run this runtime. " +
      "Current value: false. Exiting.",
    );
    process.exit(1);
  }

  logger.warn("runtime/real-trading: REAL MONEY TRADING MODE — real money at risk");

  await bootstrapRuntime({
    mode: "live",
    sinkFactory: (adapter) => new LiveExecutionSink(adapter),
    initialCapital: env.initialCapital,
    startupLeg1: env.startupLeg1 || undefined,
    startupLeg2: env.startupLeg2 || undefined,
  });
}

main().catch((err) => {
  logger.error("runtime/real-trading: fatal error", { err });
  process.exit(1);
});
