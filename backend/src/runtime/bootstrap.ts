/**
 * runtime/bootstrap.ts
 *
 * Shared runtime bootstrap for paper-trading and real-trading entry points.
 * Boots the engine infrastructure (EventBus, Orchestrator, adapters, HTTP
 * server). Strategies are normally started and stopped through the REST API
 * (POST /api/strategies/start|stop).
 *
 * Standalone / debug mode: if startupLeg1 and startupLeg2 are both provided
 * (via STARTUP_LEG1 / STARTUP_LEG2 env vars), a pairs strategy is
 * automatically registered on boot. On restart, the existing DB run is
 * resumed rather than creating a duplicate row.
 *
 * The two entry points differ only in:
 *   - mode ("paper" | "live") — selects Alpaca paper vs live endpoints
 *   - sinkFactory — PaperExecutionSink vs LiveExecutionSink
 *   - initialCapital — starting equity for the in-memory portfolio tracker
 */

import http from "http";
import { EventBus } from "../core/engine/eventBus";
import { Orchestrator } from "../core/engine/orchestrator";
import { SymbolStateManager } from "../core/state/symbolState";
import { PortfolioStateManager } from "../core/state/portfolioState";
import { OrderStateManager } from "../core/state/orderState";
import { RiskEngine } from "../core/risk/riskEngine";
import { ExecutionEngine } from "../core/execution/executionEngine";
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
  insertStrategyRun,
  updateStrategyRun,
  findRunningStartupRun,
} from "../adapters/supabase/repositories";
import type { IExecutionSink } from "../core/execution/executionEngine";
import type { OrderSubmittedEvent, OrderFilledEvent, OrderCanceledEvent } from "../types/events";
import type { StrategyRun } from "../types/strategy";
import type { Symbol } from "../types/common";
import { newId } from "../utils/ids";
import { nowMs } from "../utils/time";
import { logger } from "../utils/logger";

export interface RuntimeConfig {
  /** "paper" uses Alpaca paper endpoints; "live" uses real-money endpoints. */
  mode: "paper" | "live";
  /**
   * Factory receives the already-constructed order adapter so the sink can
   * delegate to it without the entry point needing to hold the EventBus.
   */
  sinkFactory: (adapter: AlpacaOrderExecutionAdapter) => IExecutionSink;
  /** Starting equity for the in-memory portfolio state manager. Set via INITIAL_CAPITAL env var. */
  initialCapital: number;
  /**
   * When both are provided, a pairs strategy is auto-registered on boot
   * (standalone / debug mode). Set via STARTUP_LEG1 / STARTUP_LEG2 env vars.
   * Leave undefined to boot with an empty registry (normal platform mode).
   */
  startupLeg1?: Symbol;
  startupLeg2?: Symbol;
}

/**
 * Boots the full trading runtime.
 * Intended to be the only call in each entry point after any pre-flight
 * gate checks have passed.
 */
export async function bootstrapRuntime(config: RuntimeConfig): Promise<void> {
  const { mode, sinkFactory, initialCapital, startupLeg1, startupLeg2 } = config;
  const isPaper = mode === "paper";

  // ------------------------------------------------------------------
  // Engine components
  // ------------------------------------------------------------------
  const eventBus = new EventBus();
  const symbolState = new SymbolStateManager();
  const portfolioState = new PortfolioStateManager(initialCapital);
  const orderState = new OrderStateManager();
  const riskEngine = new RiskEngine();

  const marketDataAdapter = new AlpacaMarketDataAdapter(eventBus, mode);
  const orderAdapter = new AlpacaOrderExecutionAdapter(eventBus, mode);

  const sink = sinkFactory(orderAdapter);
  const executionEngine = new ExecutionEngine(sink);

  const orchestrator = new Orchestrator(
    eventBus,
    symbolState,
    portfolioState,
    orderState,
    riskEngine,
    executionEngine,
    mode,
  );

  // ------------------------------------------------------------------
  // Optional startup strategy (standalone / debug mode).
  //
  // Only runs when STARTUP_LEG1 and STARTUP_LEG2 are both set. On restart,
  // finds the existing running DB row by startupKey and resumes it instead
  // of creating a duplicate. On clean boot, inserts a new row.
  // ------------------------------------------------------------------
  let startupRunId: string | undefined;

  if (startupLeg1 && startupLeg2) {
    const pairsConfig = createPairsConfig(startupLeg1, startupLeg2);
    const strategy = new PairsStrategy(pairsConfig);
    const startupKey = `${strategy.type}:${[startupLeg1, startupLeg2].sort().join(":")}`;

    const existingRun = await findRunningStartupRun(startupKey).catch((err) => {
      logger.error("bootstrap: findRunningStartupRun failed, will create fresh run", { err });
      return null;
    });

    if (existingRun) {
      startupRunId = existingRun.id;
      await updateStrategyRun(startupRunId, {
        meta: { ...(existingRun.meta as Record<string, unknown> ?? {}), resumedAt: nowMs() },
      }).catch((err) =>
        logger.error("bootstrap: failed to record resumedAt on strategy run", { err }),
      );
      logger.info("bootstrap: resuming startup strategy run", { runId: startupRunId, startupKey });
    } else {
      startupRunId = newId();
      const run: StrategyRun = {
        id: startupRunId,
        strategyId: startupRunId,
        strategyType: strategy.type as StrategyRun["strategyType"],
        name: pairsConfig.name,
        config: pairsConfig as unknown as StrategyRun["config"],
        status: "running",
        executionMode: mode,
        startedAt: nowMs(),
        totalSignals: 0,
        totalOrders: 0,
        realizedPnl: 0,
        meta: { startupKey },
      };
      await insertStrategyRun(run).catch((err) => {
        logger.error("bootstrap: failed to persist startup strategy run — continuing without DB record", { err });
      });
      logger.info("bootstrap: registered startup strategy run", { runId: startupRunId, startupKey });
    }

    orchestrator.registerStrategy(strategy, startupRunId);
    marketDataAdapter.subscribe(pairsConfig.symbols);
    logger.info(`bootstrap: startup strategy active [${startupLeg1}/${startupLeg2}]`);
  } else {
    logger.info("bootstrap: no startup strategy configured — waiting for API-managed strategies");
  }

  // ------------------------------------------------------------------
  // Connect adapters and start the engine
  // ------------------------------------------------------------------
  await marketDataAdapter.connect().catch((err) => {
    logger.error("bootstrap: market data connect failed — engine will start but no live data until reconnect", { err });
  });
  await orderAdapter.connectTradeStream().catch((err) => {
    logger.error("bootstrap: order stream connect failed — fills will not be received until reconnect", { err });
  });

  orchestrator.start();

  // ------------------------------------------------------------------
  // Persistence hooks — fire-and-forget; DB errors never crash the engine
  // ------------------------------------------------------------------
  eventBus.on<OrderSubmittedEvent>("ORDER_SUBMITTED", (event) => {
    insertOrder(event.payload, isPaper).catch((err) =>
      logger.error("persistence: insertOrder failed", { err }),
    );
  });

  eventBus.on<OrderFilledEvent>("ORDER_FILLED", (event) => {
    insertFill(event.fill, isPaper).catch((err) =>
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

  // ------------------------------------------------------------------
  // HTTP + WebSocket server
  // ------------------------------------------------------------------
  const app = createApp({
    orchestrator,
    symbolState,
    portfolioState,
    riskEngine,
    marketDataAdapter,
    executionMode: mode,
  });
  const server = http.createServer(app);
  attachWebSocketServer(server, eventBus);
  server.listen(env.port, () => {
    logger.info(`Server listening on port ${env.port} (REST + WebSocket) [${mode.toUpperCase()} MODE]`);
  });

  // ------------------------------------------------------------------
  // Graceful shutdown
  // ------------------------------------------------------------------
  const shutdown = async (): Promise<void> => {
    logger.warn(`bootstrap: shutting down [${mode} mode]`);
    clearInterval(snapshotTimer);
    orchestrator.stop();
    marketDataAdapter.disconnect();
    orderAdapter.disconnect();
    if (startupRunId) {
      await updateStrategyRun(startupRunId, { status: "stopped", stoppedAt: nowMs() }).catch(
        (err) => logger.error("bootstrap: failed to mark startup run as stopped", { err }),
      );
    }
    server.close();
    process.exit(0);
  };

  process.on("SIGINT",  () => { shutdown().catch(() => process.exit(1)); });
  process.on("SIGTERM", () => { shutdown().catch(() => process.exit(1)); });
}
