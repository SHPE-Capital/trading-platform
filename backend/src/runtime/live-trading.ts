/**
 * runtime/live-trading.ts
 *
 * Real-money live trading runtime entry point.
 * Structurally mirrors runtime/live.ts (paper trading) but uses the Alpaca
 * live endpoint and LiveExecutionSink instead of PaperExecutionSink.
 *
 * DUAL FEATURE GATE — both of the following must be explicitly set before
 * this runtime will start:
 *   ALPACA_TRADING_MODE=live
 *   ENABLE_LIVE_TRADING=true
 *
 * Either gate failing causes an immediate logged exit before any connection
 * to Alpaca live systems is opened. This prevents accidental live-trading
 * from a misconfigured environment.
 */

import http from "http";
import { EventBus } from "../core/engine/eventBus";
import { Orchestrator } from "../core/engine/orchestrator";
import { SymbolStateManager } from "../core/state/symbolState";
import { PortfolioStateManager } from "../core/state/portfolioState";
import { OrderStateManager } from "../core/state/orderState";
import { RiskEngine } from "../core/risk/riskEngine";
import { ExecutionEngine } from "../core/execution/executionEngine";
import { LiveExecutionSink } from "../core/execution/liveExecution";
import { AlpacaMarketDataAdapter } from "../adapters/alpaca/marketData";
import { AlpacaOrderExecutionAdapter } from "../adapters/alpaca/orderExecution";
import { PairsStrategy } from "../strategies/pairs/pairsStrategy";
import { createPairsConfig } from "../strategies/pairs/pairsConfig";
import { createApp } from "../app/index";
import { attachWebSocketServer } from "../app/websocket";
import { env } from "../config/env";
import { DEFAULT_SNAPSHOT_INTERVAL_MS } from "../config/defaults";
import {
  insertOrder,
  insertFill,
  updateOrder,
  insertPortfolioSnapshot,
} from "../adapters/supabase/repositories";
import type { OrderSubmittedEvent, OrderFilledEvent, OrderCanceledEvent } from "../types/events";
import { logger } from "../utils/logger";

const INITIAL_CAPITAL = 100_000;

async function main(): Promise<void> {
  // Both flags must be set independently. Requiring two separate env vars
  // prevents live trading from being enabled by a single accidental change.
  if (env.alpacaTradingMode !== "live") {
    logger.error(
      "runtime/live-trading: ALPACA_TRADING_MODE must be 'live' to run this runtime. " +
      "Current value: '" + env.alpacaTradingMode + "'. Exiting.",
    );
    process.exit(1);
  }
  if (!env.enableLiveTrading) {
    logger.error(
      "runtime/live-trading: ENABLE_LIVE_TRADING must be 'true' to run this runtime. " +
      "Current value: false. Exiting.",
    );
    process.exit(1);
  }

  logger.warn("runtime/live-trading: LIVE TRADING MODE — real money at risk");

  const eventBus = new EventBus();
  const symbolState = new SymbolStateManager();
  const portfolioState = new PortfolioStateManager(INITIAL_CAPITAL);
  const orderState = new OrderStateManager();
  const riskEngine = new RiskEngine();

  const marketDataAdapter = new AlpacaMarketDataAdapter(eventBus, "live");
  const orderAdapter = new AlpacaOrderExecutionAdapter(eventBus, "live");

  const liveSink = new LiveExecutionSink(orderAdapter);
  const executionEngine = new ExecutionEngine(liveSink);

  const orchestrator = new Orchestrator(
    eventBus,
    symbolState,
    portfolioState,
    orderState,
    riskEngine,
    executionEngine,
    "live",
  );

  const pairsConfig = createPairsConfig("SPY", "QQQ");
  const pairsStrategy = new PairsStrategy(pairsConfig);
  orchestrator.registerStrategy(pairsStrategy);

  await marketDataAdapter.connect();
  await orderAdapter.connectTradeStream();

  orchestrator.start();
  marketDataAdapter.subscribe(pairsConfig.symbols);

  eventBus.on<OrderSubmittedEvent>("ORDER_SUBMITTED", (event) => {
    insertOrder(event.payload, false).catch((err) =>
      logger.error("persistence: insertOrder failed", { err }),
    );
  });

  eventBus.on<OrderFilledEvent>("ORDER_FILLED", (event) => {
    insertFill(event.fill, false).catch((err) =>
      logger.error("persistence: insertFill failed", { err }),
    );
    updateOrder(event.orderId, {
      status: "filled",
      filledQty: event.fill.qty,
      avgFillPrice: event.fill.price,
      closedAt: event.fill.ts,
      updatedAt: event.fill.ts,
    }).catch((err) =>
      logger.error("persistence: updateOrder (filled) failed", { err }),
    );
  });

  eventBus.on<OrderCanceledEvent>("ORDER_CANCELED", (event) => {
    updateOrder(event.orderId, {
      status: "canceled",
      updatedAt: event.ts,
      closedAt: event.ts,
    }).catch((err) =>
      logger.error("persistence: updateOrder (canceled) failed", { err }),
    );
  });

  const snapshotTimer = setInterval(() => {
    insertPortfolioSnapshot(portfolioState.getSnapshot()).catch((err) =>
      logger.error("persistence: insertPortfolioSnapshot failed", { err }),
    );
  }, DEFAULT_SNAPSHOT_INTERVAL_MS);

  const app = createApp({ orchestrator, symbolState, portfolioState, riskEngine, marketDataAdapter });
  const server = http.createServer(app);
  attachWebSocketServer(server, eventBus);
  server.listen(env.port, () => {
    logger.info(`Server listening on port ${env.port} (REST + WebSocket) [LIVE MODE]`);
  });

  const shutdown = (): void => {
    logger.warn("runtime/live-trading: shutting down live trading session");
    clearInterval(snapshotTimer);
    orchestrator.stop();
    marketDataAdapter.disconnect();
    orderAdapter.disconnect();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("runtime/live-trading: fatal error", { err });
  process.exit(1);
});
