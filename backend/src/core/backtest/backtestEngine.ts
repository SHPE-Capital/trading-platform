/**
 * core/backtest/backtestEngine.ts
 *
 * Backtest execution engine. Drives historical bar data through the same
 * Orchestrator pipeline used in live trading: state updates → strategy
 * evaluation → risk → simulated execution → portfolio update.
 *
 * Key design: the engine uses the same Orchestrator and strategy code.
 * The only difference is that events are sourced from historical bars
 * and fills are simulated rather than sent to a live broker.
 *
 * Inputs:  BacktestConfig, historical Bar array from BacktestLoader.
 * Outputs: BacktestResult with equity curve, fills, and performance metrics.
 */

import { EventBus } from "../engine/eventBus";
import { Orchestrator } from "../engine/orchestrator";
import { SymbolStateManager } from "../state/symbolState";
import { PortfolioStateManager } from "../state/portfolioState";
import { OrderStateManager } from "../state/orderState";
import { RiskEngine } from "../risk/riskEngine";
import { ExecutionEngine } from "../execution/executionEngine";
import { SimulatedExecutionSink } from "../execution/simulatedExecution";
import { BacktestLoader } from "./backtestLoader";
import { BACKTEST_RISK_CONFIG } from "../../config/defaults";
import { logger } from "../../utils/logger";
import { nowMs, msToIso } from "../../utils/time";
import { newId } from "../../utils/ids";
import type { BacktestConfig, BacktestResult } from "../../types/backtest";
import type { PortfolioSnapshot } from "../../types/portfolio";
import type { IStrategy } from "../../strategies/base/strategy";
import type { Fill } from "../../types/orders";
import type { BacktestProgressPoint } from "./backtestStreamManager";

export class BacktestEngine {
  private readonly loader = new BacktestLoader();

  /**
   * Runs a full backtest with the given config and strategy factory.
   * The strategyFactory receives the Orchestrator's shared state objects
   * so strategies can be instantiated with the correct dependencies.
   *
   * @param config - BacktestConfig describing the test parameters
   * @param strategyFactory - Function that creates and returns IStrategy instances
   * @returns BacktestResult with full equity curve, metrics, and order history
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

    // Set up isolated engine instances for this run
    const eventBus = new EventBus();
    const symbolState = new SymbolStateManager();
    const portfolioState = new PortfolioStateManager(config.initialCapital);
    const orderState = new OrderStateManager();
    const riskEngine = new RiskEngine(BACKTEST_RISK_CONFIG);
    const simulatedSink = new SimulatedExecutionSink(
      eventBus,
      symbolState,
      "backtest",
      config.slippageBps,
      config.commissionPerShare,
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

    // Register strategies
    const strategies = strategyFactory({ symbolState, portfolioState, orderState, eventBus });
    for (const strategy of strategies) {
      orchestrator.registerStrategy(strategy);
    }

    // Load historical bars
    const bars = await this.loader.loadBars(
      config.strategyConfig.symbols,
      config.startDate,
      config.endDate,
      "1Min",
    );

    const equityCurve: PortfolioSnapshot[] = [];
    orchestrator.start();

    const realDateNow = Date.now;
    const totalBars = bars.length;
    // Sample at most 5000 equity curve points to prevent OOM on long backtests
    const sampleEvery = Math.max(1, Math.floor(totalBars / 5000));

    try {
      // OVERRIDE: Simulate wall-clock time for the duration of the backtest loop.
      // This process-global patch ensures that strategies and state managers using `nowMs()`
      // correctly advance with simulated bar time rather than collapsing all historical bars
      // into a single wall-clock millisecond.
      // TODO: Future refactor should remove this and inject a deterministic clock via `EvaluationContext`.
      let barIndex = 0;
      for (const bar of bars) {
        Date.now = () => bar.ts;
        eventBus.publish({
          id: newId(),
          type: "BAR_RECEIVED",
          ts: bar.ts,
          mode: "backtest",
          simulatedTs: bar.ts,
          payload: bar,
        });

        if (barIndex % sampleEvery === 0) {
          const snap = portfolioState.getSnapshot();
          equityCurve.push(snap);
          onProgress?.({ ts: bar.ts, equity: snap.equity, barIndex, totalBars });
        }
        barIndex++;
      }
    } finally {
      // Guarantee restoration even if an error is thrown
      Date.now = realDateNow;
    }

    // TASK 1: End-of-run Mark-to-Market (MTM)
    // 5. Final MTM pass: value all open positions at the final bar's close price.
    // This ensures totalReturn reflects current market value of open positions.
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

    const result: BacktestResult = {
      id: config.id,
      config,
      status: "completed",
      started_at: startedAt,
      completed_at: completedAt,
      final_portfolio: finalPortfolio,
      metrics: this._computeMetrics(equityCurve, fills, config.initialCapital, startedAt, completedAt),
      equity_curve: equityCurve,
      orders: orderState.getAllOrders(),
      fills,
      event_count: bars.length,
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
    // Trade-level metrics with proper FIFO lot accounting.
    //
    // Each opener fill is broken into a "lot" with remaining qty plus a
    // commission-per-share figure (commission / qty). A closer fill consumes
    // qty from the front of the opener queue; each consumed slice produces
    // exactly one realized PnL entry. Residual opener qty is preserved across
    // closers (fix for partial closes that previously dropped the residual).
    //
    // Trade-count definition (encoded here): one realized PnL entry per
    // closer-vs-opener slice. A 10-lot opened then closed in two 5-lot
    // closers therefore counts as TWO trades — one per matched slice. This
    // matches the convention used elsewhere in the audit's test suite.
    interface Lot { price: number; qty: number; commissionPerShare: number; }
    const longLots = new Map<string, Lot[]>();   // openers held long, to be closed by sells
    const shortLots = new Map<string, Lot[]>();  // openers held short, to be closed by buys
    const pnlPerTrade: number[] = [];

    const consume = (
      lots: Lot[],
      closerQty: number,
      closerPrice: number,
      closerCommissionPerShare: number,
      direction: "long" | "short",
    ): number => {
      // Returns the qty actually closed (≤ closerQty) — any remainder must
      // open a position on the opposite side by the caller.
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
      };
    }

    // TASK 3: Reconcile totals with the portfolio ledger
    // The portfolio is the source of truth for equity and total realized/unrealized PnL.
    const lastSnapshot = equityCurve[equityCurve.length - 1];
    const totalReturn = lastSnapshot.equity - initialCapital;
    const totalReturnPct = totalReturn / initialCapital;

    // Maximum drawdown
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
    };
  }
}
