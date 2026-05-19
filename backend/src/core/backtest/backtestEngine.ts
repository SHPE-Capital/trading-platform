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
import { validateBars, type ValidationIssue } from "./dataValidation";
import { computeAnalytics } from "./performanceAnalytics";
import { BacktestLoader } from "./backtestLoader";
import { BACKTEST_RISK_CONFIG } from "../../config/defaults";
import { logger } from "../../utils/logger";
import { nowMs, setClockOverride } from "../../utils/time";
import { newId } from "../../utils/ids";
import type { BacktestConfig, BacktestResult } from "../../types/backtest";
import type { PortfolioSnapshot } from "../../types/portfolio";
import type { IStrategy } from "../../strategies/base/strategy";
import type { BaseStrategyConfig } from "../../types/strategy";
import type { Fill } from "../../types/orders";
import type { Bar } from "../../types/market";
import type { BacktestProgressPoint } from "./backtestStreamManager";

export class BacktestEngine {
  private readonly loader = new BacktestLoader();

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
  ): Promise<BacktestResult> {
    const startedAt = nowMs();
    logger.info("BacktestEngine: starting", { id: config.id, name: config.name });

    // Resolve effective fill model: defaults < legacy slippage/commission fields < explicit override.
    const fillModel: FillModelConfig = {
      ...DEFAULT_FILL_MODEL,
      slippageBps: config.slippageBps,
      commissionPerShare: config.commissionPerShare,
      ...(config.fillModel ?? {}),
    };

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
    // Derive strategyVersion from the first strategy that declares one, so the DB
    // column is populated even when the caller doesn't set it explicitly in config.
    const effectiveStrategyVersion =
      config.strategyVersion ?? strategies.find((s) => s.version != null)?.version;
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

    try {
      for await (const window of this.loader.streamBars(
        config.strategyConfig.symbols,
        config.startDate,
        config.endDate,
        "1Min",
      )) {
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
          simulatedNow = batch[0].ts;

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
              id: newId(),
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
        }
      }
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
      },
    };

    const result: BacktestResult = {
      id: config.id,
      config: effectiveStrategyVersion != null
        ? { ...config, strategyVersion: effectiveStrategyVersion }
        : config,
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

  private _computeMetrics(
    equityCurve: PortfolioSnapshot[],
    fills: Fill[],
    initialCapital: number,
  ) {
    // Trade-level FIFO lot accounting — unchanged from the prior revision.
    interface Lot { price: number; qty: number; commissionPerShare: number; }
    const longLots = new Map<string, Lot[]>();
    const shortLots = new Map<string, Lot[]>();
    const pnlPerTrade: number[] = [];

    const consume = (
      lots: Lot[],
      closerQty: number,
      closerPrice: number,
      closerCommissionPerShare: number,
      direction: "long" | "short",
    ): number => {
      let remaining = closerQty;
      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0];
        const slice = Math.min(lot.qty, remaining);
        const grossPnl =
          direction === "long"
            ? (closerPrice - lot.price) * slice
            : (lot.price - closerPrice) * slice;
        const allocatedCommission =
          slice * lot.commissionPerShare + slice * closerCommissionPerShare;
        pnlPerTrade.push(grossPnl - allocatedCommission);
        lot.qty -= slice;
        remaining -= slice;
        if (lot.qty === 0) lots.shift();
      }
      return closerQty - remaining;
    };

    for (const fill of fills) {
      const commissionPerShare = fill.qty > 0 ? fill.commission / fill.qty : 0;
      if (fill.side === "buy") {
        const shorts = shortLots.get(fill.symbol) ?? [];
        const closedQty = shorts.length > 0
          ? consume(shorts, fill.qty, fill.price, commissionPerShare, "short")
          : 0;
        if (shorts.length > 0 || closedQty > 0) shortLots.set(fill.symbol, shorts);
        const residual = fill.qty - closedQty;
        if (residual > 0) {
          const lots = longLots.get(fill.symbol) ?? [];
          lots.push({ price: fill.price, qty: residual, commissionPerShare });
          longLots.set(fill.symbol, lots);
        }
      } else {
        const longs = longLots.get(fill.symbol) ?? [];
        const closedQty = longs.length > 0
          ? consume(longs, fill.qty, fill.price, commissionPerShare, "long")
          : 0;
        if (longs.length > 0 || closedQty > 0) longLots.set(fill.symbol, longs);
        const residual = fill.qty - closedQty;
        if (residual > 0) {
          const lots = shortLots.get(fill.symbol) ?? [];
          lots.push({ price: fill.price, qty: residual, commissionPerShare });
          shortLots.set(fill.symbol, lots);
        }
      }
    }

    const totalTrades = pnlPerTrade.length;
    const wins = pnlPerTrade.filter((p) => p > 0);
    const losses = pnlPerTrade.filter((p) => p <= 0);
    const winRate = totalTrades > 0 ? wins.length / totalTrades : 0;
    const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;

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
