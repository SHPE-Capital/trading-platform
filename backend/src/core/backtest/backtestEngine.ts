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

    try {
      // OVERRIDE: Simulate wall-clock time for the duration of the backtest loop.
      // This process-global patch ensures that strategies and state managers using `nowMs()`
      // correctly advance with simulated bar time rather than collapsing all historical bars
      // into a single wall-clock millisecond.
      // TODO: Future refactor should remove this and inject a deterministic clock via `EvaluationContext`.
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

        // Take a portfolio snapshot after each bar for the equity curve
        equityCurve.push(portfolioState.getSnapshot());
      }
    } finally {
      // Guarantee restoration even if an error is thrown
      Date.now = realDateNow;
    }

    // TASK 1: End-of-run Mark-to-Market (MTM)
    // 5. Final MTM pass: value all open positions at the final bar's close price.
    // This ensures totalReturn reflects current market value of open positions.
    if (bars.length > 0) {
      for (const symbol of symbolState.getSymbols()) {
        const state = symbolState.get(symbol);
        if (state?.latestBar) {
          portfolioState.updatePrice(symbol, state.latestBar.close);
        }
      }
      equityCurve.push(portfolioState.getSnapshot());
    }

    orchestrator.stop();

    const finalPortfolio = portfolioState.getSnapshot();
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
    // Compute trade-level metrics by pairing entry and exit fills per symbol
    const pnlPerTrade: number[] = [];
    const buyMap = new Map<string, Fill[]>();
    const sellMap = new Map<string, Fill[]>();

    for (const fill of fills) {
      if (fill.side === "buy") {
        const sells = sellMap.get(fill.symbol);
        if (sells && sells.length > 0) {
          // Covering a short
          const matchedSell = sells.shift()!;
          const pnl = (matchedSell.price - fill.price) * fill.qty - fill.commission - matchedSell.commission;
          pnlPerTrade.push(pnl);
        } else {
          // Opening a long
          const existing = buyMap.get(fill.symbol) ?? [];
          existing.push(fill);
          buyMap.set(fill.symbol, existing);
        }
      } else {
        const buys = buyMap.get(fill.symbol);
        if (buys && buys.length > 0) {
          // Closing a long
          const matchedBuy = buys.shift()!;
          const pnl = (fill.price - matchedBuy.price) * fill.qty - fill.commission - matchedBuy.commission;
          pnlPerTrade.push(pnl);
        } else {
          // Opening a short
          const existing = sellMap.get(fill.symbol) ?? [];
          existing.push(fill);
          sellMap.set(fill.symbol, existing);
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
