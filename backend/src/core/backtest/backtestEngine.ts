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
    const riskEngine = new RiskEngine();
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

    // Drive bars through the engine
    for (const bar of bars) {
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

    orchestrator.stop();

    const finalPortfolio = portfolioState.getSnapshot();
    const completedAt = nowMs();

    const fills = orderState.getAllOrders().flatMap((o) => o.fills);

    const result: BacktestResult = {
      id: config.id,
      config,
      status: "completed",
      startedAt,
      completedAt,
      finalPortfolio,
      metrics: this._computeMetrics(equityCurve, fills, config.initialCapital, startedAt, completedAt),
      equityCurve,
      orders: orderState.getAllOrders(),
      fills,
      eventCount: bars.length,
    };

    logger.info("BacktestEngine: completed", {
      id: config.id,
      bars: bars.length,
      totalReturn: result.metrics.totalReturnPct.toFixed(2) + "%",
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
    // Compute trade-level metrics by pairing buy+sell fills per symbol
    const pnlPerTrade: number[] = [];
    const buyMap = new Map<string, Fill[]>();

    for (const fill of fills) {
      if (fill.side === "buy") {
        const existing = buyMap.get(fill.symbol) ?? [];
        existing.push(fill);
        buyMap.set(fill.symbol, existing);
      } else {
        const buys = buyMap.get(fill.symbol);
        if (buys && buys.length > 0) {
          const matchedBuy = buys.shift()!;
          const pnl = (fill.price - matchedBuy.price) * fill.qty - fill.commission - matchedBuy.commission;
          pnlPerTrade.push(pnl);
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

    const finalEquity = equityCurve[equityCurve.length - 1].equity;
    const totalReturn = finalEquity - initialCapital;
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
