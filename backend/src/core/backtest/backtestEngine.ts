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
import { validateBars } from "./dataValidation";
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
    for (const strategy of strategies) {
      const budget = (strategy.config as BaseStrategyConfig).riskBudget;
      if (budget) riskEngine.registerStrategyBudget({ ...budget, strategyId: strategy.id });
      orchestrator.registerStrategy(strategy);
    }

    // Load and validate historical bars.
    const rawBars = await this.loader.loadBars(
      config.strategyConfig.symbols,
      config.startDate,
      config.endDate,
      "1Min",
    );
    const validation = validateBars(rawBars, config.strategyConfig.symbols, "raw");

    if (!validation.ok && config.strictDataValidation) {
      throw new Error(
        `BacktestEngine: data validation failed in strict mode (${
          validation.issues.filter((i) => i.severity === "error").length
        } errors)`,
      );
    }
    if (!validation.ok) {
      logger.warn("BacktestEngine: dropping invalid bars after validation", {
        invalid: validation.metadata.invalidBarsDropped,
        duplicates: validation.metadata.duplicateBarsDropped,
      });
    }
    const bars = validation.bars;

    const equityCurve: PortfolioSnapshot[] = [];
    orchestrator.start();

    const totalBars = bars.length;
    // Sample at most 5000 equity curve points to prevent OOM on long backtests.
    // We still emit one snapshot per *timestamp batch* (not per bar) to keep
    // the equity curve aligned with the simulated wall clock.
    const sampleEvery = Math.max(1, Math.floor(totalBars / 5000));

    // Group bars by timestamp so we process all same-ts symbols together —
    // this eliminates the cross-symbol same-bar lookahead asymmetry that the
    // alphabetical tiebreaker only partially mitigated. Bars are already
    // sorted (ts asc, symbol asc) by BacktestLoader.
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

    // Inject simulated clock so any code that calls nowMs() during the run
    // sees the simulated time rather than wall-clock time. The override is
    // updated for every batch and cleared in the finally block.
    let simulatedNow = startedAt;
    setClockOverride(() => simulatedNow);

    try {
      let processedBars = 0;
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const ts = batch[0].ts;
        simulatedNow = ts;

        // Phase 1: flush queued orders against each bar in this batch BEFORE
        // exposing the new bars to strategies. The sink subscribes to
        // BAR_RECEIVED in its constructor and runs before the orchestrator's
        // handler, so publishing the BAR_RECEIVED events in phase 2 alone
        // would already produce per-bar flush semantics — but we want
        // strategies to see the full cross-section at this ts, with state
        // already updated. We split flush from publish below.
        for (const bar of batch) {
          simulatedSink.processBarOpen(bar);
        }

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

        if (i % sampleEvery === 0) {
          const snap = portfolioState.getSnapshot();
          equityCurve.push(snap);
          onProgress?.({ ts, equity: snap.equity, barIndex: processedBars, totalBars });
        }
        processedBars += batch.length;
      }
    } finally {
      // Always clear the clock override — even if the run threw partway through.
      setClockOverride(null);
    }

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

    const baseMetrics = this._computeMetrics(equityCurve, fills, config.initialCapital, periodStart, periodEnd);
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
      config,
      status: "completed",
      started_at: startedAt,
      completed_at: completedAt,
      final_portfolio: finalPortfolio,
      metrics,
      equity_curve: equityCurve,
      orders: orderState.getAllOrders(),
      fills,
      event_count: bars.length,
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
      bars: bars.length,
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
    periodStart: number,
    periodEnd: number,
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
        periodStart,
        periodEnd,
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
      periodStart,
      periodEnd,
      tradePnls: pnlPerTrade,
    };
  }
}
