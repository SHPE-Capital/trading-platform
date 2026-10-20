/**
 * core/backtest/backtestEngine.ts
 *
 * Backtest execution engine. Drives historical bar data through the same
 * Orchestrator pipeline used in live trading: state updates → strategy
 * evaluation → risk → simulated execution → portfolio update.
 *
 * Key design changes vs the prior revision:
 *   - Deterministic clock injection via setClockOverride(). The legacy
 *     `Date.now = …` monkey patch is gone.
 *   - Multi-symbol timestamp batching: all bars sharing a timestamp are
 *     processed together. For each ts we first flush queued orders against
 *     the new bars (no-lookahead next-open fills), then update symbol state
 *     and mark portfolio prices for ALL same-ts symbols, then evaluate
 *     strategies once per (ts, symbol) so pair/multi-symbol strategies see
 *     a coherent cross-section.
 *   - Configurable fill model and data validation, surfaced in the result
 *     metadata.
 *
 * Inputs:  BacktestConfig, historical Bar array from BacktestLoader.
 * Outputs: BacktestResult with equity curve, fills, performance metrics, and
 *          fill-model / validation metadata.
 */

import { EventBus } from "../engine/eventBus";
import { Orchestrator } from "../engine/orchestrator";
import { SymbolStateManager } from "../state/symbolState";
import { PortfolioStateManager } from "../state/portfolioState";
import { OrderStateManager } from "../state/orderState";
import { RiskEngine } from "../risk/riskEngine";
import { ExecutionEngine } from "../execution/executionEngine";
import { SimulatedExecutionSink } from "../execution/simulatedExecution";
import { DEFAULT_FILL_MODEL, type FillModelConfig } from "../execution/fillModel";
import { resolveExecution, validateExecution } from "../execution/quoteFillModel";
import type { HistoricalTickSource } from "./tickSource";
import { validateBars, type ValidationIssue } from "./dataValidation";
import { computeAnalytics } from "./performanceAnalytics";
import { buildTradeLedger, tradeStats } from "../analytics/tradeLedger";
import { BacktestLoader } from "./backtestLoader";
import { BACKTEST_RISK_CONFIG } from "../../config/defaults";
import { logger } from "../../utils/logger";
import { nowMs, setClockOverride, isClockLockedForLive, barEndMs } from "../../utils/time";
import { newEventId } from "../../utils/ids";
import type { BacktestConfig, BacktestResult } from "../../types/backtest";
import type { PortfolioSnapshot } from "../../types/portfolio";
import type { IStrategy } from "../../strategies/base/strategy";
import type { BaseStrategyConfig } from "../../types/strategy";
import type { Fill } from "../../types/orders";
import type { Bar, HistoricalFeed } from "../../types/market";
import type { BacktestProgressPoint } from "./backtestStreamManager";

/**
 * How long the simulation loop may run before yielding to the event loop.
 * In a worker process, timers (lease heartbeat, progress writes) only fire
 * between yields; a window of 10k bars processed without one could outlast
 * the job lease and get the run reclaimed by another worker mid-flight.
 */
const YIELD_EVERY_MS = 200;

/**
 * Version of the simulation semantics, recorded on every config and result
 * and part of the dedup fingerprint, so a result produced under different
 * semantics is never reused. A config without one predates versioning (v1).
 *   v1: bars processed at their start time.
 *   v2: bars processed when they complete (start + timeframe), the moment
 *       their close is known; strategies, risk and orders see that time. An
 *       order never fills against a bar that completed before it was placed
 *       (v1 filled an order for a symbol published later in the same batch at
 *       that symbol's same-minute open — before the decision).
 */
export const BACKTEST_ENGINE_VERSION = 2;

export interface BacktestRunOptions {
  /** Aborting stops the run at the next yield point with an AbortError. */
  signal?: AbortSignal;
}

export interface BacktestEngineOptions {
  /**
   * Historical quotes and trades for the quote execution model, per feed.
   * Without it, a config asking for quote fills is refused.
   */
  tickSource?: (feed: HistoricalFeed) => HistoricalTickSource;
}

/** Bound on arrival rounds per batch: fills can trigger orders (a kill switch) that also need pricing. */
const MAX_ARRIVAL_ROUNDS = 8;

export class BacktestEngine {
  constructor(
    private readonly loader: BacktestLoader = new BacktestLoader(),
    private readonly options: BacktestEngineOptions = {},
  ) {}

  /**
   * Runs a full backtest with the given config and strategy factory.
   */
  async run(
    config: BacktestConfig,
    strategyFactory: (deps: {
      symbolState: SymbolStateManager;
      portfolioState: PortfolioStateManager;
      orderState: OrderStateManager;
      eventBus: EventBus;
    }) => IStrategy[],
    onProgress?: (point: BacktestProgressPoint) => void,
    options: BacktestRunOptions = {},
  ): Promise<BacktestResult> {
    const { signal } = options;
    signal?.throwIfAborted();
    // A backtest installs a simulated clock and runs a long CPU-bound loop.
    // Doing either inside a trading process corrupts live timestamps and
    // starves the event loop that owns the broker WebSocket. Refuse early,
    // before any state is built or any market data is fetched.
    if (isClockLockedForLive()) {
      throw new Error(
        "BacktestEngine cannot run in a live or paper trading process. " +
          "Run backtests in the API-only process (npm run dev:api, port 8082) " +
          "or via npm run dev:backtest.",
      );
    }

    const startedAt = nowMs();
    logger.info("BacktestEngine: starting", { id: config.id, name: config.name });

    // Resolve effective fill model: defaults < legacy slippage/commission fields < explicit override.
    const fillModel: FillModelConfig = {
      ...DEFAULT_FILL_MODEL,
      slippageBps: config.slippageBps,
      commissionPerShare: config.commissionPerShare,
      ...(config.fillModel ?? {}),
    };

    // How orders are priced: the bar model above, or real quotes around each order.
    const execution = resolveExecution(config.execution);
    const executionError = validateExecution(execution);
    if (executionError) throw new Error(`Invalid execution config: ${executionError}`);
    let tickSource: HistoricalTickSource | null = null;
    if (execution.model === "quote") {
      if (!this.options.tickSource) {
        throw new Error("Quote fills need historical quotes, but this engine has no tick source configured");
      }
      tickSource = this.options.tickSource(execution.feed);
    }

    // Set up isolated engine instances for this run
    const eventBus = new EventBus();
    const symbolState = new SymbolStateManager();
    const portfolioState = new PortfolioStateManager(config.initialCapital);
    const orderState = new OrderStateManager();
    const riskEngine = new RiskEngine({ ...BACKTEST_RISK_CONFIG, ...(config.riskConfig ?? {}) });
    const simulatedSink = new SimulatedExecutionSink(
      eventBus,
      symbolState,
      "backtest",
      fillModel.slippageBps,
      fillModel.commissionPerShare,
      fillModel,
      execution,
    );
    const executionEngine = new ExecutionEngine(simulatedSink);

    const orchestrator = new Orchestrator(
      eventBus,
      symbolState,
      portfolioState,
      orderState,
      riskEngine,
      executionEngine,
      "backtest",
    );

    // Register strategies and any per-strategy capital budgets
    const strategies = strategyFactory({ symbolState, portfolioState, orderState, eventBus });
    // Record the algorithm version of the code that actually runs here. The API
    // that queued the job stamps config.strategyVersion from its own build; during
    // a deploy a worker on a different build may claim it, and labelling the
    // result with the API's version would attribute it to code that never ran.
    const builtVersion = strategies.find((s) => s.version != null)?.version;
    if (config.strategyVersion != null && builtVersion != null && config.strategyVersion !== builtVersion) {
      throw new Error(
        `Backtest was queued for algorithm v${config.strategyVersion}, but this worker runs ` +
        `v${builtVersion}. Re-run it once the deploy has finished.`,
      );
    }
    const effectiveStrategyVersion = builtVersion ?? config.strategyVersion;
    // Same deploy race for the engine itself: the API fingerprinted this job
    // under its own engine version, so a worker running other semantics must
    // not produce the result.
    if (config.engineVersion != null && config.engineVersion !== BACKTEST_ENGINE_VERSION) {
      throw new Error(
        `Backtest was queued for engine v${config.engineVersion}, but this worker runs ` +
        `v${BACKTEST_ENGINE_VERSION}. Re-run it once the deploy has finished.`,
      );
    }
    for (const strategy of strategies) {
      const budget = (strategy.config as BaseStrategyConfig).riskBudget;
      if (budget) riskEngine.registerStrategyBudget({ ...budget, strategyId: strategy.id });
      orchestrator.registerStrategy(strategy);
    }

    // Estimate total 1-minute timestamp batches from the date range.
    // Base: 252 trading days/yr × 390 min/day ≈ 269.75 batches per calendar day.
    // Multiplied by 3 to stay above actual bar counts in all observed cases:
    const daysInRange =
      (new Date(config.endDate).getTime() - new Date(config.startDate).getTime()) / 86_400_000;
    const estimatedBatches = Math.max(1, Math.round(daysInRange * (252 * 390) / 365 * 3));
    const estimatedTotalBars = estimatedBatches * config.strategyConfig.symbols.length;
    // Sample at most 5000 equity curve points. sampleEvery is in terms of
    // timestamp batches (not individual bars) to keep the curve aligned with
    // the simulated wall clock.
    const sampleEvery = Math.max(1, Math.floor(estimatedBatches / 5000));

    const equityCurve: PortfolioSnapshot[] = [];
    orchestrator.start();

    // Streaming validation state — accumulated across windows from streamBars.
    const validationAcc = {
      issues: [] as ValidationIssue[],
      totalBarsInput: 0,
      totalBarsAccepted: 0,
      duplicateBarsDropped: 0,
      invalidBarsDropped: 0,
      largeGapsBySymbol: {} as Record<string, number>,
      medianSpacingMsBySymbol: {} as Record<string, number>,
      seenSymbols: new Set<string>(),
      hasRawWarning: false,
    };

    // Inject simulated clock so any code that calls nowMs() during the run
    // sees the simulated time rather than wall-clock time. Cleared in finally.
    let simulatedNow = startedAt;
    setClockOverride(() => simulatedNow);

    let processedBars = 0;
    let batchIndex = 0;
    let lastYieldAt = performance.now();

    try {
      for await (const window of this.loader.streamBars(
        config.strategyConfig.symbols,
        config.startDate,
        config.endDate,
        "1Min",
      )) {
        signal?.throwIfAborted();
        // Validate this window. Cross-window ordering issues can't occur:
        // streamBars' safe-horizon guarantee means no batch ever spans windows.
        const v = validateBars(window, config.strategyConfig.symbols, "raw");

        for (const issue of v.issues) {
          // Deduplicate the raw-adjustment warning that validateBars emits per call.
          if (issue.message === v.metadata.rawAdjustmentWarning) {
            if (!validationAcc.hasRawWarning) {
              validationAcc.issues.push(issue);
              validationAcc.hasRawWarning = true;
            }
            continue;
          }
          validationAcc.issues.push(issue);
        }
        validationAcc.totalBarsInput += v.metadata.totalBarsInput;
        validationAcc.totalBarsAccepted += v.metadata.totalBarsAccepted;
        validationAcc.duplicateBarsDropped += v.metadata.duplicateBarsDropped;
        validationAcc.invalidBarsDropped += v.metadata.invalidBarsDropped;
        for (const [s, c] of Object.entries(v.metadata.largeGapsBySymbol)) {
          validationAcc.largeGapsBySymbol[s] = (validationAcc.largeGapsBySymbol[s] ?? 0) + c;
        }
        for (const [s, m] of Object.entries(v.metadata.medianSpacingMsBySymbol)) {
          validationAcc.medianSpacingMsBySymbol[s] ??= m;
        }
        for (const bar of v.bars) validationAcc.seenSymbols.add(bar.symbol);

        if (!v.ok && config.strictDataValidation) {
          throw new Error(
            `BacktestEngine: data validation failed in strict mode (${
              v.issues.filter((i) => i.severity === "error").length
            } errors)`,
          );
        }
        if (!v.ok) {
          logger.warn("BacktestEngine: dropping invalid bars after validation", {
            invalid: v.metadata.invalidBarsDropped,
            duplicates: v.metadata.duplicateBarsDropped,
          });
        }

        const bars = v.bars;

        // Group this window's validated bars into timestamp batches.
        // streamBars guarantees no batch spans two windows.
        const batches: Bar[][] = [];
        let currentBatch: Bar[] = [];
        let currentTs: number | null = null;
        for (const bar of bars) {
          if (currentTs === null || bar.ts === currentTs) {
            currentBatch.push(bar);
            currentTs = bar.ts;
          } else {
            batches.push(currentBatch);
            currentBatch = [bar];
            currentTs = bar.ts;
          }
        }
        if (currentBatch.length > 0) batches.push(currentBatch);

        for (const batch of batches) {
          // Orders whose regular session closed before this minute began expire first.
          if (simulatedSink.hasExpiring()) {
            for (const plan of simulatedSink.planExpiries(batch[0].ts)) {
              simulatedNow = Math.max(simulatedNow, plan.ts);
              simulatedSink.applyExpiry(plan);
            }
          }

          // Quote model: orders resting through the minute these bars cover act
          // on the trades printed during it, before its end is processed: limits
          // fill, and stops trigger and are priced from their trigger.
          if (tickSource && simulatedSink.hasResting()) {
            for (const plan of await simulatedSink.planResting(batch, tickSource)) {
              simulatedNow = Math.max(simulatedNow, plan.ts);
              simulatedSink.applyResting(plan);
            }
            if (simulatedSink.hasArrivals()) {
              await this._resolveArrivals(simulatedSink, tickSource, (ts) => { simulatedNow = Math.max(simulatedNow, ts); });
            }
          }

          // A batch becomes known when its bars complete — the 10:00 bar at
          // 10:01 — so strategies, risk checks and new orders see that time.
          simulatedNow = barEndMs(batch[0]);

          // Phase 1: flush queued orders against each bar in this batch BEFORE
          // exposing the new bars to strategies. The sink subscribes to
          // BAR_RECEIVED in its constructor and runs before the orchestrator's
          // handler, so publishing the BAR_RECEIVED events in phase 2 alone
          // would already produce per-bar flush semantics — but we want
          // strategies to see the full cross-section at this ts, with state
          // already updated. We split flush from publish below.
          for (const bar of batch) simulatedSink.processBarOpen(bar);

          // Phase 2: update symbol state and portfolio marks for every bar in
          // the batch BEFORE evaluating any strategy. This is the multi-symbol
          // no-lookahead phase.
          for (const bar of batch) {
            symbolState.onBar(bar);
            portfolioState.updatePrice(bar.symbol, bar.close);
          }

          // Phase 3: publish a synthetic BAR_RECEIVED for each bar in the
          // batch. The simulated sink will see an empty queue (we already
          // flushed in phase 1) so this is a strict no-op for fills. The
          // orchestrator's handler will call _evaluateStrategies for each
          // symbol — strategies see a coherent cross-section because all
          // symbol states were already updated in phase 2.
          for (const bar of batch) {
            eventBus.publish({
              id: newEventId(),
              type: "BAR_RECEIVED",
              ts: bar.ts,
              mode: "backtest",
              simulatedTs: bar.ts,
              payload: bar,
            });
          }

          if (batchIndex % sampleEvery === 0) {
            const snap = portfolioState.getSnapshot();
            equityCurve.push(snap);
            onProgress?.({ ts: simulatedNow, equity: snap.equity, barIndex: processedBars, totalBars: estimatedTotalBars });
          }
          processedBars += batch.length;
          batchIndex++;

          // Quote model: price the orders just placed when each reaches the
          // market, latencyMs after this batch's decisions.
          if (tickSource) await this._resolveArrivals(simulatedSink, tickSource, (ts) => { simulatedNow = Math.max(simulatedNow, ts); });

          if (performance.now() - lastYieldAt >= YIELD_EVERY_MS) {
            await new Promise<void>((resolve) => setImmediate(resolve));
            lastYieldAt = performance.now();
            signal?.throwIfAborted();
          }
        }
      }
      // Orders placed on the final bar can still reach the market under the quote model.
      if (tickSource) await this._resolveArrivals(simulatedSink, tickSource, (ts) => { simulatedNow = Math.max(simulatedNow, ts); });
    } finally {
      // Always clear the clock override — even if the run threw partway through.
      setClockOverride(null);
    }

    // Finalize validation — add "no bars" warnings for any expected symbol without data.
    for (const sym of config.strategyConfig.symbols) {
      if (!validationAcc.seenSymbols.has(sym)) {
        validationAcc.issues.push({
          severity: "warning" as const,
          symbol: sym,
          message: "Requested symbol has no bars in the period",
        });
      }
    }
    const validation = {
      issues: validationAcc.issues,
      metadata: {
        totalBarsInput: validationAcc.totalBarsInput,
        totalBarsAccepted: validationAcc.totalBarsAccepted,
        duplicateBarsDropped: validationAcc.duplicateBarsDropped,
        invalidBarsDropped: validationAcc.invalidBarsDropped,
        largeGapsBySymbol: validationAcc.largeGapsBySymbol,
        medianSpacingMsBySymbol: validationAcc.medianSpacingMsBySymbol,
        adjustment: "raw" as const,
        rawAdjustmentWarning: validationAcc.hasRawWarning
          ? "Bars use raw (unadjusted) prices: corporate actions (splits/dividends) are not applied. Long-horizon backtests across action dates may show artificial jumps."
          : undefined,
      },
    };

    // Terminal cleanup: expire any IOC market intents still queued.
    simulatedSink.expireAllPending();

    // Final mark-to-market against the last observed close for every symbol.
    for (const symbol of symbolState.getSymbols()) {
      const state = symbolState.get(symbol);
      if (state?.latestBar) {
        portfolioState.updatePrice(symbol, state.latestBar.close);
      }
    }
    equityCurve.push(portfolioState.getSnapshot());

    orchestrator.stop();
    const finalPortfolio = equityCurve[equityCurve.length - 1];
    const completedAt = nowMs();

    const fills = orderState.getAllOrders().flatMap((o) => o.fills);

    const periodStart = new Date(config.startDate).getTime();
    const periodEnd = new Date(config.endDate).getTime();

    const baseMetrics = this._computeMetrics(equityCurve, fills, config.initialCapital);
    const analytics = computeAnalytics(
      equityCurve,
      baseMetrics.tradePnls,
      periodStart,
      periodEnd,
      config.riskFreeRateAnnual ?? 0,
      config.benchmarkCurve,
    );

    const useIntraday =
      (config.strategyConfig as { sharpeConvention?: string }).sharpeConvention === "intraday";

    const metrics = {
      totalReturn: baseMetrics.totalReturn,
      totalReturnPct: baseMetrics.totalReturnPct,
      maxDrawdown: baseMetrics.maxDrawdown,
      winRate: baseMetrics.winRate,
      totalTrades: baseMetrics.totalTrades,
      avgWin: baseMetrics.avgWin,
      avgLoss: baseMetrics.avgLoss,
      sharpeRatio: useIntraday ? analytics.intradaySharpeRatio : analytics.sharpeRatio,
      sortinoRatio: useIntraday ? analytics.intradaySortinoRatio : analytics.sortinoRatio,
      calmarRatio: analytics.calmarRatio,
      profitFactor: analytics.profitFactor,
      periodStart,
      periodEnd,
      meta: {
        annualizedReturn: analytics.annualizedReturn,
        annualizedVol: analytics.annualizedVol,
        riskFreeRateAnnual: analytics.riskFreeRateAnnual,
        benchmarkReturn: analytics.benchmarkReturn,
        returnPeriods: analytics.periodCount,
        // How quote fills priced the run's orders; kept in metrics so it survives saving.
        ...(execution.model === "quote" ? { execution: simulatedSink.executionReport() } : {}),
      },
    };

    const result: BacktestResult = {
      id: config.id,
      config: {
        ...config,
        ...(effectiveStrategyVersion != null ? { strategyVersion: effectiveStrategyVersion } : {}),
        engineVersion: BACKTEST_ENGINE_VERSION,
      },
      status: "completed",
      started_at: startedAt,
      completed_at: completedAt,
      final_portfolio: finalPortfolio,
      metrics,
      equity_curve: equityCurve,
      orders: orderState.getAllOrders(),
      fills,
      event_count: processedBars,
      data_validation: {
        issues: validation.issues,
        metadata: validation.metadata,
      },
      fill_model: fillModel,
      assumptions: {
        periodCount: analytics.periodCount,
        insufficientReturnsForRatios:
          analytics.sharpeRatio === undefined && analytics.sortinoRatio === undefined,
        benchmarkProvided: !!config.benchmarkCurve && config.benchmarkCurve.length >= 2,
        riskFreeRateAnnual: analytics.riskFreeRateAnnual,
      },
    };

    logger.info("BacktestEngine: completed", {
      id: config.id,
      bars: processedBars,
      totalReturn: (result.metrics.totalReturnPct * 100).toFixed(2) + "%",
    });

    return result;
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  /**
   * Prices every quote-model order waiting to reach the market, publishing
   * each decision at its own time. A fill can place new orders (an emergency
   * close), which arrive in turn; the rounds are bounded.
   */
  private async _resolveArrivals(
    sink: SimulatedExecutionSink,
    source: HistoricalTickSource,
    setClock: (ts: number) => void,
  ): Promise<void> {
    for (let round = 0; round < MAX_ARRIVAL_ROUNDS && sink.hasArrivals(); round++) {
      for (const plan of await sink.planArrivals(source)) {
        setClock(plan.ts);
        sink.applyArrival(plan);
      }
    }
  }

  private _computeMetrics(
    equityCurve: PortfolioSnapshot[],
    fills: Fill[],
    initialCapital: number,
  ) {
    // Trade-level FIFO lot accounting, shared with the live run reports.
    const pnlPerTrade = buildTradeLedger(fills).trades.map((t) => t.pnl);
    const { totalTrades, winRate, avgWin, avgLoss } = tradeStats(pnlPerTrade);

    if (equityCurve.length === 0) {
      return {
        totalReturn: 0,
        totalReturnPct: 0,
        maxDrawdown: 0,
        winRate,
        totalTrades,
        avgWin,
        avgLoss,
        tradePnls: pnlPerTrade,
      };
    }

    const lastSnapshot = equityCurve[equityCurve.length - 1];
    const totalReturn = lastSnapshot.equity - initialCapital;
    const totalReturnPct = totalReturn / initialCapital;

    let peak = initialCapital;
    let maxDrawdown = 0;
    for (const snap of equityCurve) {
      if (snap.equity > peak) peak = snap.equity;
      const dd = (peak - snap.equity) / peak;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    return {
      totalReturn,
      totalReturnPct,
      maxDrawdown,
      winRate,
      totalTrades,
      avgWin,
      avgLoss,
      tradePnls: pnlPerTrade,
    };
  }
}
