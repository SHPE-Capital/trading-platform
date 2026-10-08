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
 *   - target — EXECUTION_TARGET: "sim" fills orders locally and never contacts
 *     a broker; the alpaca targets trade the account behind the configured keys
 *   - sinkFactory — PaperExecutionSink vs LiveExecutionSink (alpaca targets)
 *   - initialCapital — starting equity for the in-memory portfolio tracker
 *
 * Before anything connects, the broker account check (core/broker/
 * brokerPreflight.ts) resolves the account this process will trade and refuses
 * to start against an account owned by another deployment.
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
import { alpacaGet, alpacaTradingBaseUrl } from "../adapters/alpaca/rest";
import { ReplayBarFeed } from "../adapters/replay/replayBarFeed";
import { SimulatedExecutionSink } from "../core/execution/simulatedExecution";
import { BrokerPreflightError, runBrokerPreflight } from "../core/broker/brokerPreflight";
import { AlpacaClockHours, alwaysOpen, type AlpacaClock } from "../core/market/marketHours";
import { findBrokerAccount, registerBrokerAccount } from "../adapters/supabase/brokerAccountRepository";
import { PROTECTED_BROKER_ACCOUNTS } from "../config/protectedAccounts";
import { AlpacaBroker } from "../adapters/alpaca/alpacaBroker";
import { SimBroker } from "../adapters/sim/simBroker";
import { JournaledExecutionSink } from "../core/execution/journaledExecution";
import { BrokerSyncService } from "../core/ledger/brokerSync";
import { LedgerMaintainer } from "../core/ledger/ledgerMaintainer";
import {
  SupabaseLedgerStore,
  SupabaseOrderJournal,
  insertRuntimeFill,
  markOrderSubmitted,
} from "../adapters/supabase/ledgerRepository";
import type { IBroker } from "../core/broker/IBroker";
import { RunBooks } from "../core/ledger/runBooks";
import { SignalRecorder } from "../core/live/signalRecorder";
import { RunStatsService } from "../core/analytics/runStatsService";
import { allocatedCapital } from "../core/analytics/runPerformance";
import {
  insertRunEvent,
  insertRunSnapshots,
  insertSignals,
  loadRunLedger,
  runIdsForOrders,
  setSignalOutcome,
  upsertRunStats,
} from "../adapters/supabase/analyticsRepository";
import { SupabaseBarCache } from "../adapters/supabase/barCacheRepository";
import { PairsStrategy } from "../strategies/pairs/pairsStrategy";
import { createPairsConfig } from "../strategies/pairs/pairsConfig";
import { createApp } from "../app/index";
import { attachWebSocketServer } from "../app/websocket";
import { env, type ExecutionTarget } from "../config/env";
import { DEFAULT_SNAPSHOT_INTERVAL_MS } from "../config/defaults";
import {
  updateOrder,
  insertPortfolioSnapshot,
  insertStrategyRun,
  updateStrategyRun,
  findRunningStartupRun,
  getFillsForRun,
  getStrategyRunById,
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
  OrderPartialFillEvent,
  OrderCanceledEvent,
  OrderRejectedEvent,
  OrderExpiredEvent,
  StrategyErrorEvent,
  StrategyRecoveredEvent,
  StrategyAutoDisabledEvent,
  RiskRejectedEvent,
  CapitalUnavailableEvent,
  StrategySignalCreatedEvent,
  QuoteReceivedEvent,
  TradeReceivedEvent,
  BarReceivedEvent,
} from "../types/events";
import type { StrategyRun } from "../types/strategy";
import type { Symbol } from "../types/common";
import { newId } from "../utils/ids";
import { nowMs, lockClockForLive } from "../utils/time";
import { logger } from "../utils/logger";

export interface RuntimeConfig {
  /** "paper" uses Alpaca paper endpoints; "live" uses real-money endpoints. */
  mode: "paper" | "live";
  /** Where orders go. "sim" needs no broker keys and never contacts a broker. */
  target: ExecutionTarget;
  /**
   * Factory receives the already-constructed order adapter so the sink can
   * delegate to it without the entry point needing to hold the EventBus.
   * Unused by "sim", which fills locally.
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
  const { mode, target, sinkFactory, initialCapital, startupLeg1, startupLeg2 } = config;
  const isPaper = mode === "paper";

  // ------------------------------------------------------------------
  // Broker account check — before any stream opens or order can be sent.
  // ------------------------------------------------------------------
  const tradingCreds = { key: env.alpacaApiKey, secret: env.alpacaApiSecret };
  let brokerAccount: string;
  try {
    const preflight = await runBrokerPreflight({
      target,
      runtimeOrigin: env.runtimeOrigin,
      expectedAccount: env.expectedBrokerAccount,
      hostname: os.hostname(),
      protectedAccounts: PROTECTED_BROKER_ACCOUNTS,
      fetchAccount: async () => {
        if (!tradingCreds.key || !tradingCreds.secret) {
          throw new BrokerPreflightError(`ALPACA_API_KEY and ALPACA_API_SECRET are required for EXECUTION_TARGET=${target}`);
        }
        const account = await alpacaGet<{ account_number: string; status: string }>(
          alpacaTradingBaseUrl(mode), "/v2/account", tradingCreds,
        );
        return { accountNumber: account.account_number, status: account.status };
      },
      findRegistered: findBrokerAccount,
      register: registerBrokerAccount,
    });
    brokerAccount = preflight.brokerAccount;
    logger.info("bootstrap: broker account check passed", {
      target, brokerAccount, kind: preflight.kind, newlyRegistered: preflight.registered, origin: env.runtimeOrigin,
    });
  } catch (err) {
    logger.error("bootstrap: broker account check failed — this runtime will not trade", {
      target, origin: env.runtimeOrigin, reason: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  // ------------------------------------------------------------------
  // Engine components
  // ------------------------------------------------------------------
  const eventBus = new EventBus();
  const symbolState = new SymbolStateManager();
  const portfolioState = new PortfolioStateManager(initialCapital);
  const orderState = new OrderStateManager();
  const riskEngine = new RiskEngine();

  // Market data: Alpaca's stream when data keys exist; otherwise (sim only) a
  // replay of cached bars through the same events.
  const hasDataKeys = !!(env.alpacaDataKey && env.alpacaDataSecret);
  const marketDataAdapter = hasDataKeys
    ? new AlpacaMarketDataAdapter(eventBus, mode)
    : new ReplayBarFeed(eventBus, mode, new SupabaseBarCache(), replayWindow());

  // Orders: a sim book fills locally on the next bar; the alpaca targets send
  // them to the account the check above resolved.
  const orderAdapter = target === "sim" ? null : new AlpacaOrderExecutionAdapter(eventBus, mode);
  const brokerSink = orderAdapter
    ? sinkFactory(orderAdapter)
    : new SimulatedExecutionSink(eventBus, symbolState, mode, 5, 0.005, {});
  // Every order is written to the ledger before it is sent; if it cannot be,
  // it is not sent (core/execution/journaledExecution.ts).
  const sink = new JournaledExecutionSink(
    brokerSink,
    new SupabaseOrderJournal(brokerAccount, isPaper),
    (intent, err) => eventBus.publish({
      id: newId(), type: "RISK_REJECTED", ts: nowMs(), mode,
      strategyId: intent.strategyId,
      reason: err.message,
      failedCheck: "JOURNAL_UNAVAILABLE",
      rejectedIntent: intent,
    }),
  );
  const executionEngine = new ExecutionEngine(sink);

  // The broker's own records, read for the ledger sync, drift, and account views.
  const broker: IBroker = orderAdapter
    ? new AlpacaBroker(brokerAccount, alpacaTradingBaseUrl(mode), tradingCreds)
    : new SimBroker(brokerAccount, initialCapital, (symbol) => {
      const s = symbolState.get(symbol);
      return s?.latestMid ?? s?.latestBar?.close ?? null;
    });
  const ledgerStore = new SupabaseLedgerStore();
  // Each run's own book (the shared one nets every strategy per symbol), and
  // its stats derived from the ledger.
  const runBooks = new RunBooks();
  const runStats = new RunStatsService({ getRun: getStrategyRunById, loadLedger: loadRunLedger, upsert: upsertRunStats });
  const runEvent = (runId: string, type: string, detail: string | null = null): void => {
    insertRunEvent(runId, type, detail).catch((err) => logger.warn("persistence: run event not recorded", { runId, type, err: String(err) }));
  };
  // Runs held at the last pass, so a run that just stopped gets one final refresh.
  let lastHeld: string[] = [];
  const ledger = new LedgerMaintainer({
    broker,
    // A sim book writes its own fills; only a real broker needs copying from.
    sync: orderAdapter ? new BrokerSyncService(broker, ledgerStore, { isPaper }) : null,
    driftStore: ledgerStore,
    eventBus,
    mode,
    intervalMs: env.brokerSyncIntervalMs,
    afterPass: async (positions, touchedOrderIds) => {
      const marks = new Map<string, number>();
      for (const p of positions) marks.set(p.symbol, p.currentPrice);
      for (const symbol of symbolState.getSymbols()) {
        const s = symbolState.get(symbol);
        const price = s?.latestMid ?? s?.latestBar?.close;
        if (price) marks.set(symbol, price);
      }
      const held = liveRuns.heldRuns();
      const touchedRuns = touchedOrderIds.length > 0 ? await runIdsForOrders(touchedOrderIds) : [];
      await runStats.refresh([...held, ...lastHeld, ...touchedRuns], marks);
      lastHeld = held;
    },
  });

  // Orders are only sent during the regular session. Alpaca's clock knows
  // holidays; a replayed session is in-session by construction.
  let clockHours: AlpacaClockHours | null = null;
  if (hasDataKeys) {
    const clockCreds = target === "sim" ? { key: env.alpacaDataKey, secret: env.alpacaDataSecret } : tradingCreds;
    clockHours = new AlpacaClockHours(() =>
      alpacaGet<AlpacaClock>(alpacaTradingBaseUrl(target === "alpaca-live" ? "live" : "paper"), "/v2/clock", clockCreds),
    );
    await clockHours.start();
    riskEngine.setMarketHours(clockHours);
  } else {
    riskEngine.setMarketHours(alwaysOpen);
  }

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
      claimOrphans: () => claimOrphanedRuns(owner, mode, env.runtimeOrigin, leaseSeconds, brokerAccount),
      heartbeat: (runIds) => heartbeatRunLeases(owner, runIds, leaseSeconds),
      release: (runId) => releaseRunLease(runId, owner),
    },
    buildStrategy: buildRunStrategy,
    // A keyless sim replays history through the strategy itself; there is no
    // live "now" to warm up to and no keys to fetch history with.
    warmUp: hasDataKeys
      ? (strategy) =>
        warmUpStrategy(strategy, (symbols, start, end) => historyLoader.loadBars(symbols, start, end, "1Min"))
      : async () => 0,
    markRunErrored: (runId, reason) =>
      updateStrategyRun(runId, { status: "error", stoppedAt: nowMs(), disabledReason: reason }),
    markRunExpired: (runId, reason) =>
      updateStrategyRun(runId, { status: "stopped", stoppedAt: nowMs(), disabledReason: reason }),
    // The book lives in memory; without this a restart or hand-off resumes a
    // run as if flat while the broker still holds its positions.
    restorePositions: async (run) => {
      const fills = await getFillsForRun(run, isPaper);
      for (const fill of fills) {
        portfolioState.applyFill(fill);
        runBooks.applyFill(run.id, fill);
      }
      runEvent(run.id, "ADOPTED", `by ${owner}; ${fills.length} fills restored`);
      return fills.length;
    },
    brokerAccount,
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
        meta: { startupKey },
        allocatedCapital: allocatedCapital(pairsConfig as { riskBudget?: { maxCapitalPct?: number } }, portfolioState.getSnapshot().equity),
        ...liveRuns.leaseFields(),
      };
      try {
        await insertStrategyRun(run);
        await liveRuns.prepare(strategy);
        liveRuns.activate(startupRunId, strategy);
        runEvent(startupRunId, "STARTED", `startup strategy on ${owner}`);
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
  if (orderAdapter) {
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
  }

  orchestrator.start();
  ledger.start();

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
        for (const id of lost) runEvent(id, "LEASE_LOST", `${owner} lost the lease; another runner holds it`);
        for (const id of expired) runEvent(id, "EXPIRED", "sandbox lifetime reached");
      },
      (err) => logger.error("bootstrap: lease maintenance failed", { err: String(err) }),
    );
  }, Math.max(5_000, Math.floor((leaseSeconds * 1000) / 3)));

  // ------------------------------------------------------------------
  // Persistence hooks — fire-and-forget; DB errors never crash the engine
  // ------------------------------------------------------------------
  // The order row was journaled before sending; these record what happened to
  // it. For an Alpaca book the fill rows come from the broker sync (keyed on
  // Alpaca's execution ids); a sim book is its own broker and writes them here.
  eventBus.on<OrderSubmittedEvent>("ORDER_SUBMITTED", (event) => {
    markOrderSubmitted(event.payload).catch((err) =>
      logger.error("persistence: markOrderSubmitted failed", { err: String(err) }),
    );
  });

  const onFill = (event: OrderFilledEvent | OrderPartialFillEvent, terminal: boolean): void => {
    // The orchestrator applied the fill first, so the order holds the cumulative quantity.
    const order = orderState.getOrder(event.orderId);
    if (order?.runId) runBooks.applyFill(order.runId, event.fill);
    updateOrder(event.orderId, {
      status: terminal ? "filled" : "partial_fill",
      filledQty: order?.filledQty ?? event.fill.qty,
      avgFillPrice: order?.avgFillPrice ?? event.fill.price,
      updatedAt: event.fill.ts,
      ...(terminal ? { closedAt: event.fill.ts } : {}),
    }).catch((err) => logger.error("persistence: updateOrder (fill) failed", { err }));
    if (orderAdapter) {
      ledger.requestSoon();
    } else {
      insertRuntimeFill(event.fill, order, brokerAccount, isPaper).catch((err) =>
        logger.error("persistence: insertRuntimeFill failed", { err: String(err) }),
      );
    }
  };
  eventBus.on<OrderFilledEvent>("ORDER_FILLED", (event) => onFill(event, true));
  eventBus.on<OrderPartialFillEvent>("ORDER_PARTIAL_FILL", (event) => onFill(event, false));

  const onClosed = (status: "canceled" | "rejected" | "expired") => (event: { orderId: string; ts: number }): void => {
    updateOrder(event.orderId, { status, updatedAt: event.ts, closedAt: event.ts }).catch((err) =>
      logger.error(`persistence: updateOrder (${status}) failed`, { err }),
    );
  };
  eventBus.on<OrderCanceledEvent>("ORDER_CANCELED", onClosed("canceled"));
  eventBus.on<OrderRejectedEvent>("ORDER_REJECTED", onClosed("rejected"));
  eventBus.on<OrderExpiredEvent>("ORDER_EXPIRED", onClosed("expired"));

  // Error streaks are persisted so the UI can show a strategy degrading before
  // the runner disables it.
  eventBus.on<StrategyErrorEvent>("STRATEGY_ERROR", (event) => {
    if (!event.runKey || event.consecutiveErrors === undefined) return;
    if (event.consecutiveErrors === 1) runEvent(event.runKey, "ERROR", `${event.phase}: ${event.error}`);
    updateStrategyRun(event.runKey, { consecutiveErrors: event.consecutiveErrors }).catch((err) =>
      logger.error("persistence: consecutive_errors update failed", { err }),
    );
  });

  eventBus.on<StrategyRecoveredEvent>("STRATEGY_RECOVERED", (event) => {
    runEvent(event.runKey, "RECOVERED");
    updateStrategyRun(event.runKey, { consecutiveErrors: 0 }).catch((err) =>
      logger.error("persistence: consecutive_errors reset failed", { err }),
    );
  });

  eventBus.on<StrategyAutoDisabledEvent>("STRATEGY_AUTO_DISABLED", (event) => {
    const reason = `Auto-disabled after ${event.consecutiveErrors} consecutive errors. Last: ${event.lastError}`;
    runEvent(event.runKey, "AUTO_DISABLED", reason);
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

  // Every signal and what became of it (sent / blocked / refused / no order).
  const signals = new SignalRecorder({ insert: insertSignals, setOutcome: setSignalOutcome, brokerAccount });
  signals.start();
  eventBus.on<StrategySignalCreatedEvent>("STRATEGY_SIGNAL_CREATED", (event) => {
    if (event.signalId) signals.record(event.signalId, event.runKey ?? null, event.ts, event.payload);
  });
  eventBus.on<OrderSubmittedEvent>("ORDER_SUBMITTED", (event) => signals.outcome(event.payload.signalId, "submitted"));
  eventBus.on<RiskRejectedEvent>("RISK_REJECTED", (event) =>
    signals.outcome(event.rejectedIntent?.signalId, "risk_rejected", `${event.failedCheck ?? "UNKNOWN"}: ${event.reason}`));
  eventBus.on<CapitalUnavailableEvent>("CAPITAL_UNAVAILABLE", (event) =>
    signals.outcome(event.signalId, "capital_unavailable", `Needed $${event.required.toFixed(2)}`));

  // Prices mark the run books.
  eventBus.on<QuoteReceivedEvent>("QUOTE_RECEIVED", (e) => runBooks.updatePrice(e.payload.symbol, e.payload.midPrice));
  eventBus.on<TradeReceivedEvent>("TRADE_RECEIVED", (e) => runBooks.updatePrice(e.payload.symbol, e.payload.price));
  eventBus.on<BarReceivedEvent>("BAR_RECEIVED", (e) => runBooks.updatePrice(e.payload.symbol, e.payload.close));

  eventBus.on<RiskRejectedEvent>("RISK_REJECTED", (event) => {
    rejections.record({
      ts: event.ts,
      strategyId: event.strategyId ?? null,
      symbol: event.rejectedIntent?.symbol ?? null,
      failedCheck: event.failedCheck ?? "UNKNOWN",
      reason: event.reason,
      intent: event.rejectedIntent,
      signalId: event.rejectedIntent?.signalId ?? null,
      runId: event.rejectedIntent?.runId ?? null,
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
      signalId: event.signalId ?? null,
      runId: event.runId ?? null,
    });
  });

  const snapshotTimer = setInterval(() => {
    insertPortfolioSnapshot(portfolioState.getSnapshot(), brokerAccount).catch((err) =>
      logger.error("persistence: insertPortfolioSnapshot failed", { err }),
    );
    insertRunSnapshots(runBooks.snapshot(liveRuns.heldRuns(), nowMs())).catch((err) =>
      logger.error("persistence: insertRunSnapshots failed", { err: String(err) }),
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
    executionTarget: target,
    brokerAccount,
    broker,
    ledgerStore,
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
    orderAdapter?.disconnect();
    clockHours?.stop();
    ledger.stop();
    await rejections.stop();
    await signals.stop();
    // Hand leases back so a successor adopts these runs now instead of after
    // they lapse. The rows stay "running" — they are paused, not stopped.
    await liveRuns.releaseAll();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT",  () => { shutdown().catch(() => process.exit(1)); });
  process.on("SIGTERM", () => { shutdown().catch(() => process.exit(1)); });
}

/**
 * Window a keyless sim runtime replays: REPLAY_FROM..REPLAY_TO, defaulting to
 * whatever is cached for the last five days.
 */
function replayWindow(): { fromMs: number; toMs: number; speed: number } {
  const toMs = env.replayTo ? new Date(env.replayTo).getTime() : nowMs();
  const fromMs = env.replayFrom ? new Date(env.replayFrom).getTime() : toMs - 5 * 86_400_000;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    throw new Error("REPLAY_FROM must be a date before REPLAY_TO");
  }
  return { fromMs, toMs, speed: env.replaySpeed };
}
