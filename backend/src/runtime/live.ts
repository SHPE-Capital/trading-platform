/**
 * runtime/live.ts
 *
 * Live paper trading runtime entry point.
 * Bootstraps all components, connects to Alpaca, registers strategies,
 * and starts the Orchestrator for real-time paper trading.
 */

import http from "http";
import { EventBus } from "../core/engine/eventBus";
import { Orchestrator } from "../core/engine/orchestrator";
import { SymbolStateManager } from "../core/state/symbolState";
import { PortfolioStateManager } from "../core/state/portfolioState";
import { OrderStateManager } from "../core/state/orderState";
import { RiskEngine } from "../core/risk/riskEngine";
import { ExecutionEngine } from "../core/execution/executionEngine";
import { PaperExecutionSink } from "../core/execution/paperExecution";
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
  logger.info("runtime/live: starting paper trading mode");

  const eventBus = new EventBus();
  const symbolState = new SymbolStateManager();
  const portfolioState = new PortfolioStateManager(INITIAL_CAPITAL);
  const orderState = new OrderStateManager();
  const riskEngine = new RiskEngine();

  const marketDataAdapter = new AlpacaMarketDataAdapter(eventBus, "paper");
  const orderAdapter = new AlpacaOrderExecutionAdapter(eventBus, "paper");

  const paperSink = new PaperExecutionSink(orderAdapter);
  const executionEngine = new ExecutionEngine(paperSink);

  const orchestrator = new Orchestrator(
    eventBus,
    symbolState,
    portfolioState,
    orderState,
    riskEngine,
    executionEngine,
    "paper",
  );

  // Example: SPY/QQQ pairs trade (configure via env or DB in production)
  const pairsConfig = createPairsConfig("SPY", "QQQ");
  const pairsStrategy = new PairsStrategy(pairsConfig);
  orchestrator.registerStrategy(pairsStrategy);

  await marketDataAdapter.connect();
  await orderAdapter.connectTradeStream();

  orchestrator.start();
  marketDataAdapter.subscribe(pairsConfig.symbols);

  // Fire-and-forget: errors are logged but never re-thrown so a DB hiccup
  // cannot crash the live engine or block the synchronous event dispatch loop.
  eventBus.on<OrderSubmittedEvent>("ORDER_SUBMITTED", (event) => {
    insertOrder(event.payload).catch((err) =>
      logger.error("persistence: insertOrder failed", { err }),
    );
  });

  eventBus.on<OrderFilledEvent>("ORDER_FILLED", (event) => {
    insertFill(event.fill).catch((err) =>
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

  // http.createServer(app) shares one port for both REST and WebSocket
  // upgrades; attachWebSocketServer scopes WS to /ws/events only.
  const app = createApp({ orchestrator, symbolState, portfolioState, riskEngine, marketDataAdapter });
  const server = http.createServer(app);
  attachWebSocketServer(server, eventBus);
  server.listen(env.port, () => {
    logger.info(`Server listening on port ${env.port} (REST + WebSocket)`);
  });

  const shutdown = (): void => {
    logger.info("runtime/live: shutting down");
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
  logger.error("runtime/live: fatal error", { err });
  process.exit(1);
});
