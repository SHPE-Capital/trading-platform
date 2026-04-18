/**
 * runtime/live.ts
 *
 * Live paper trading runtime entry point.
 * Bootstraps all components, connects to Alpaca, registers strategies,
 * and starts the Orchestrator for real-time paper trading.
 *
 * Execution flow:
 *   1. Create EventBus, state managers, risk engine, execution engine
 *   2. Connect AlpacaMarketDataAdapter and AlpacaOrderExecutionAdapter
 *   3. Create PaperExecutionSink, inject into ExecutionEngine
 *   4. Instantiate and register strategies
 *   5. Start the Orchestrator
 *   6. Subscribe to symbols via MarketDataAdapter
 *   7. Start Express API server for frontend communication
 *   8. Handle shutdown gracefully on SIGINT/SIGTERM
 *
 * Inputs:  Environment variables; strategy config from env/defaults.
 * Outputs: Running live paper trading session.
 */

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
import { env } from "../config/env";
import { logger } from "../utils/logger";

const INITIAL_CAPITAL = 100_000;

async function main(): Promise<void> {
  logger.info("runtime/live: starting paper trading mode");

  // ---- Core infrastructure ----
  const eventBus = new EventBus();
  const symbolState = new SymbolStateManager();
  const portfolioState = new PortfolioStateManager(INITIAL_CAPITAL);
  const orderState = new OrderStateManager();
  const riskEngine = new RiskEngine();

  // ---- Adapters ----
  const marketDataAdapter = new AlpacaMarketDataAdapter(eventBus, "paper");
  const orderAdapter = new AlpacaOrderExecutionAdapter(eventBus, "paper");

  // ---- Execution ----
  const paperSink = new PaperExecutionSink(orderAdapter);
  const executionEngine = new ExecutionEngine(paperSink);

  // ---- Orchestrator ----
  const orchestrator = new Orchestrator(
    eventBus,
    symbolState,
    portfolioState,
    orderState,
    riskEngine,
    executionEngine,
    "paper",
  );

  // ---- Register strategies ----
  // Example: SPY/QQQ pairs trade (configure via env or DB in production)
  const pairsConfig = createPairsConfig("SPY", "QQQ");
  const pairsStrategy = new PairsStrategy(pairsConfig);
  orchestrator.registerStrategy(pairsStrategy);

  // ---- Connect to Alpaca ----
  await marketDataAdapter.connect();
  await orderAdapter.connectTradeStream();

  // ---- Start engine ----
  orchestrator.start();
  marketDataAdapter.subscribe(pairsConfig.symbols);

  // ---- Start API server ----
  const app = createApp({ orchestrator, symbolState });
  app.listen(env.port, () => {
    logger.info(`API server listening on port ${env.port}`);
  });

  // ---- Graceful shutdown ----
  const shutdown = (): void => {
    logger.info("runtime/live: shutting down");
    orchestrator.stop();
    marketDataAdapter.disconnect();
    orderAdapter.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("runtime/live: fatal error", { err });
  process.exit(1);
});
