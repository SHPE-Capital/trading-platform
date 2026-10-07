/**
 * runtime/bootstrap.ts
 *
 * Shared runtime bootstrap for paper-trading and real-trading entry points.
 * Boots the engine infrastructure (EventBus, Orchestrator, adapters, HTTP
 * server). Strategies are normally started and stopped through the REST API
 * (POST /api/strategies/start|stop, proposal approval).
 *
 * Which runs this process trades is decided by leases (Part 05): on boot, and
 * every heartbeat after, it adopts running runs of its own execution mode that
 * no live runner holds — warming each from history before it trades — and it
 * drops any run whose lease another runner took. Two runtimes started at once
 * therefore split nothing: each run is traded by exactly one of them.
 *
 * Standalone / debug mode: if startupLeg1 and startupLeg2 are both provided
 * (via STARTUP_LEG1 / STARTUP_LEG2 env vars), a pairs strategy is created on
 * first boot; on restart the existing running row is adopted like any other.
 *
 * The two entry points differ only in:
 *   - mode ("paper" | "live") — selects Alpaca paper vs live endpoints
 *   - sinkFactory — PaperExecutionSink vs LiveExecutionSink
 *   - initialCapital — starting equity for the in-memory portfolio tracker
 */

import http from "http";
import os from "os";
import { randomBytes } from "crypto";
import { EventBus } from "../core/engine/eventBus";
import { Orchestrator } from "../core/engine/orchestrator";
import { SymbolStateManager } from "../core/state/symbolState";
import { PortfolioStateManager } from "../core/state/portfolioState";
import { OrderStateManager } from "../core/state/orderState";
import { RiskEngine } from "../core/risk/riskEngine";
import { ExecutionEngine } from "../core/execution/executionEngine";
import { BacktestLoader } from "../core/backtest/backtestLoader";
import { LiveRunCoordinator } from "../core/live/liveRunCoordinator";
import { warmUpStrategy } from "../core/live/strategyWarmer";
import { RiskRejectionRecorder } from "../core/live/riskRejectionRecorder";
import { AlpacaMarketDataAdapter } from "../adapters/alpaca/marketData";
import { AlpacaOrderExecutionAdapter } from "../adapters/alpaca/orderExecution";
import { SupabaseBarCache } from "../adapters/supabase/barCacheRepository";
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
  getFillsForRun,
} from "../adapters/supabase/repositories";
import {
  claimOrphanedRuns,
  heartbeatRunLeases,
  releaseRunLease,
} from "../adapters/supabase/runLeaseRepository";
import { insertRiskRejections, resolveStrategyOwner } from "../adapters/supabase/riskRejectionRepository";
import { STRATEGY_FACTORY } from "../config/strategyDefaults";
import type { IExecutionSink } from "../core/execution/executionEngine";
import type { IStrategy } from "../strategies/base/strategy";
import type {
  OrderSubmittedEvent,
  OrderFilledEvent,
  OrderCanceledEvent,
  StrategyErrorEvent,
  StrategyRecoveredEvent,
  StrategyAutoDisabledEvent,
  RiskRejectedEvent,
  CapitalUnavailableEvent,
} from "../types/events";
import type { StrategyRun } from "../types/strategy";
import type { Symbol } from "../types/common";
import { newId } from "../utils/ids";
import { nowMs, lockClockForLive } from "../utils/time";
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
 * Rebuilds a persisted run's strategy. The config's own id is what risk budgets
 * and rejection attribution key on; rows from before that was set fall back to
 * the run's strategy_id.
 */
function buildRunStrategy(run: StrategyRun): IStrategy {
  const factory = STRATEGY_FACTORY[run.strategyType];
  if (!factory) throw new Error(`No factory for strategy type "${run.strategyType}"`);
  const raw = run.config as unknown as Record<string, unknown>;
  return factory({ ...raw, id: (raw.id as string | undefined) ?? run.strategyId });
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
    { maxConsecutiveErrors: env.maxConsecutiveStrategyErrors },
  );

  // ------------------------------------------------------------------
  // Run ownership (Part 05)
  // ------------------------------------------------------------------
  const owner = `${mode}:${os.hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;
  const leaseSeconds = env.runLeaseSeconds;
  // Warm-up reads through the shared bar cache, so restarting a runner costs
  // little or no Alpaca quota for history a backtest already fetched.
  const historyLoader = new BacktestLoader({ cache: new SupabaseBarCache() });

  const liveRuns = new LiveRunCoordinator(owner, leaseSeconds, {
    registry: orchestrator,
    subscribe: (symbols) => marketDataAdapter.subscribe(symbols),
    leases: {
      claimOrphans: () => claimOrphanedRuns(owner, mode, env.runtimeOrigin, leaseSeconds),
      heartbeat: (runIds) => heartbeatRunLeases(owner, runIds, leaseSeconds),
      release: (runId) => releaseRunLease(runId, owner),
    },
    buildStrategy: buildRunStrategy,
    warmUp: (strategy) =>
      warmUpStrategy(strategy, (symbols, start, end) => historyLoader.loadBars(symbols, start, end, "1Min")),
    markRunErrored: (runId, reason) =>
      updateStrategyRun(runId, { status: "error", stoppedAt: nowMs(), disabledReason: reason }),
    markRunExpired: (runId, reason) =>
      updateStrategyRun(runId, { status: "stopped", stoppedAt: nowMs(), disabledReason: reason }),
    // The book lives in memory; without this a restart or hand-off resumes a
    // run as if flat while the broker still holds its positions.
    restorePositions: async (run) => {
      const fills = await getFillsForRun(run, isPaper);
      for (const fill of fills) portfolioState.applyFill(fill);
      return fills.length;
    },
  });
  logger.info("bootstrap: runner identity", { owner, leaseSeconds });

  // ------------------------------------------------------------------
  // Optional startup strategy (standalone / debug mode).
  //
  // A fresh boot inserts the row already leased to this runner. On restart the
  // existing running row is left for adoption below, like any other run.
  // ------------------------------------------------------------------
  let startupRunId: string | undefined;

  if (startupLeg1 && startupLeg2) {
    const pairsConfig = createPairsConfig(startupLeg1, startupLeg2);
    const startupKey = `pairs_trading:${[startupLeg1, startupLeg2].sort().join(":")}`;

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
      logger.info("bootstrap: startup strategy run exists — adopting it with the rest", { runId: startupRunId, startupKey });
    } else {
      startupRunId = newId();
      const strategy = new PairsStrategy({ ...pairsConfig, id: pairsConfig.id ?? startupRunId });
      const run: StrategyRun = {
        id: startupRunId,
        strategyId: strategy.id ?? startupRunId,
        strategyType: "pairs_trading",
        strategyVersion: strategy.version,
        name: pairsConfig.name,
        config: { ...pairsConfig, id: strategy.id } as unknown as StrategyRun["config"],
        status: "running",
        executionMode: mode,
        runtimeOrigin: env.runtimeOrigin,
        buildSha: env.buildSha,
        buildDirty: env.buildDirty,
        startedAt: nowMs(),
        totalSignals: 0,
        totalOrders: 0,
        realizedPnl: 0,
        meta: { startupKey },
        ...liveRuns.leaseFields(),
      };
      try {
        await insertStrategyRun(run);
        await liveRuns.prepare(strategy);
        liveRuns.activate(startupRunId, strategy);
        logger.info(`bootstrap: startup strategy active [${startupLeg1}/${startupLeg2}]`, { runId: startupRunId });
      } catch (err) {
        // Without a persisted, leased row this runner has no claim to trade it.
        logger.error("bootstrap: failed to persist startup strategy run — not starting it", { err });
      }
    }
  } else {
    logger.info("bootstrap: no startup strategy configured — waiting for API-managed strategies");
  }

  // ------------------------------------------------------------------
  // Adopt running runs no live runner holds — warmed from history before any
  // live tick arrives, since the market data connection opens after this.
  // ------------------------------------------------------------------
  const adopted = await liveRuns.adoptOrphans();
  logger.info(`bootstrap: adopted ${adopted.length} running strategy run(s)`);

  // ------------------------------------------------------------------
  // Connect adapters and start the engine
  // ------------------------------------------------------------------
  await marketDataAdapter.connect().catch((err) => {
    logger.error("bootstrap: market data connect failed — engine will start but no live data until reconnect", { err });
  });
  // Alpaca does not replay trade_updates sent while the stream was down, so
  // after a reconnect every order still open here is read back over REST.
  orderAdapter.onReconnect(() => {
    const open = orderState.getOpenOrders();
    if (open.length === 0) return;
    orderAdapter.reconcileOrders(open).catch((err) =>
      logger.error("bootstrap: order reconciliation after reconnect failed", { err: String(err) }),
    );
  });
  await orderAdapter.connectTradeStream().catch((err) => {
    logger.error("bootstrap: order stream connect failed — fills will not be received until reconnect", { err });
  });

  orchestrator.start();

  // This process is now trading. Claim the clock so that a backtest started
  // here by any path fails loudly instead of silently feeding simulated time to
  // the live orchestrator, risk checks, and quote timestamps.
  lockClockForLive(mode);

  // Heartbeat three times per lease: a runner survives two missed beats before
  // a peer may adopt its runs.
  const leaseTimer = setInterval(() => {
    liveRuns.tick().then(
      ({ lost, adopted: newlyAdopted, expired }) => {
        if (lost.length > 0 || newlyAdopted.length > 0 || expired.length > 0) {
          logger.info("bootstrap: lease maintenance", { lost, adopted: newlyAdopted, expired });
        }
      },
      (err) => logger.error("bootstrap: lease maintenance failed", { err: String(err) }),
    );
  }, Math.max(5_000, Math.floor((leaseSeconds * 1000) / 3)));

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

  // Error streaks are persisted so the UI can show a strategy degrading before
  // the runner disables it.
  eventBus.on<StrategyErrorEvent>("STRATEGY_ERROR", (event) => {
    if (!event.runKey || event.consecutiveErrors === undefined) return;
    updateStrategyRun(event.runKey, { consecutiveErrors: event.consecutiveErrors }).catch((err) =>
      logger.error("persistence: consecutive_errors update failed", { err }),
    );
  });

  eventBus.on<StrategyRecoveredEvent>("STRATEGY_RECOVERED", (event) => {
    updateStrategyRun(event.runKey, { consecutiveErrors: 0 }).catch((err) =>
      logger.error("persistence: consecutive_errors reset failed", { err }),
    );
  });

  eventBus.on<StrategyAutoDisabledEvent>("STRATEGY_AUTO_DISABLED", (event) => {
    const reason = `Auto-disabled after ${event.consecutiveErrors} consecutive errors. Last: ${event.lastError}`;
    updateStrategyRun(event.runKey, {
      status: "error",
      stoppedAt: nowMs(),
      consecutiveErrors: event.consecutiveErrors,
      disabledReason: reason,
    })
      // Status first, then the lease: releasing a still-"running" row would let
      // another runner adopt the broken strategy straight back.
      .then(() => liveRuns.deactivate(event.runKey))
      .catch((err) => logger.error(
        "persistence: auto-disable update failed — retaining lease to prevent re-adoption",
        { err },
      ));
  });

  // Blocked orders, persisted for the contention view (Part 06).
  const rejections = new RiskRejectionRecorder({
    insert: insertRiskRejections,
    resolveOwner: resolveStrategyOwner,
  });
  rejections.start();

  eventBus.on<RiskRejectedEvent>("RISK_REJECTED", (event) => {
    rejections.record({
      ts: event.ts,
      strategyId: event.strategyId ?? null,
      symbol: event.rejectedIntent?.symbol ?? null,
      failedCheck: event.failedCheck ?? "UNKNOWN",
      reason: event.reason,
      intent: event.rejectedIntent,
    });
  });

  eventBus.on<CapitalUnavailableEvent>("CAPITAL_UNAVAILABLE", (event) => {
    rejections.record({
      ts: event.ts,
      strategyId: event.strategyId ?? null,
      symbol: null,
      failedCheck: "CAPITAL_UNAVAILABLE",
      reason: `Needed $${event.required.toFixed(2)}; $${event.available.toFixed(2)} unreserved`,
      intent: { intentId: event.intentId, required: event.required, available: event.available },
    });
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
    liveRuns,
  });
  const server = http.createServer(app);
  attachWebSocketServer(server, eventBus);
  server.listen(env.port, () => {
    logger.info(`Server listening on port ${env.port} (REST + WebSocket) [${mode.toUpperCase()} MODE]`);
  });

  // ------------------------------------------------------------------
  // Graceful shutdown
  //
  // Runs once. Under npm + nodemon (as in docker-compose.dev.yml) one stop
  // delivers the signal twice; a second, concurrent pass found no leases left
  // to release and exited before the first pass's release finished, so the
  // successor had to wait out the lease instead of adopting at once.
  // ------------------------------------------------------------------
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.warn(`bootstrap: shutting down [${mode} mode]`);
    clearInterval(snapshotTimer);
    clearInterval(leaseTimer);
    orchestrator.stop();
    marketDataAdapter.disconnect();
    orderAdapter.disconnect();
    await rejections.stop();
    // Hand leases back so a successor adopts these runs now instead of after
    // they lapse. The rows stay "running" — they are paused, not stopped.
    await liveRuns.releaseAll();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT",  () => { shutdown().catch(() => process.exit(1)); });
  process.on("SIGTERM", () => { shutdown().catch(() => process.exit(1)); });
}
