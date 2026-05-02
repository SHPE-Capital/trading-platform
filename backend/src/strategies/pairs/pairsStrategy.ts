/**
 * strategies/pairs/pairsStrategy.ts
 *
 * Pairs trading strategy implementation. Monitors the spread between two
 * correlated instruments and generates entry/exit signals based on z-score
 * deviation from the rolling mean.
 *
 * Algorithm:
 *   1. Compute the spread = price_leg1 - hedgeRatio × price_leg2
 *   2. Maintain a rolling window of spread values
 *   3. Compute z-score = (spread - mean) / std
 *   4. Enter long spread when z < -entryZScore (spread unusually low → expect mean reversion up)
 *   5. Enter short spread when z > entryZScore (spread unusually high → expect mean reversion down)
 *   6. Exit when |z| < exitZScore (spread reverted to mean)
 *   7. Stop-loss exit when |z| > stopLossZScore (spread moved further against us)
 *   8. Max-hold exit when position age exceeds maxHoldingTimeMs
 *
 * The strategy emits one signal per leg per trigger. The execution layer
 * handles routing both legs into actual orders.
 *
 * Inputs:  EvaluationContext with symbol/portfolio/order state.
 * Outputs: StrategySignal with PairsSignalMeta, or null (no action this tick).
 */

import { BaseStrategy } from "../base/strategy";
import { RollingTimeWindow } from "../../core/state/rollingWindow";
import { computeZScore } from "../../services/indicators/zscore";
import { computeOLSHedgeRatio } from "../../services/indicators/ols";
import { logger } from "../../utils/logger";
import { nowMs } from "../../utils/time";
import type { EvaluationContext } from "../base/strategy";
import type { StrategySignal, StrategyType } from "../../types/strategy";
import type {
  PairsStrategyConfig,
  PairsInternalState,
  PairsSignalMeta,
} from "./pairsTypes";

export class PairsStrategy extends BaseStrategy {
  readonly type: StrategyType = "pairs_trading";

  private readonly state: PairsInternalState;

  /** Signal funnel debug counters (active when BACKTEST_DEBUG=1) */
  private readonly _debugEnabled = process.env.BACKTEST_DEBUG === "1";
  private readonly _debug = {
    evaluateCalls: 0,
    missingLegData: 0,
    missingPrices: 0,
    cooldownSuppressed: 0,
    insufficientObservations: 0,
    zScoreNull: 0,
    entrySignals: 0,
    exitSignals: 0,
    noSignal: 0,
  };

  /**
   * @param config - Full PairsStrategyConfig (use createPairsConfig() helper)
   */
  constructor(readonly pairsConfig: PairsStrategyConfig) {
    // BaseStrategy expects BaseStrategyConfig — PairsStrategyConfig satisfies that shape
    super(pairsConfig as never);
    this.state = this._initState();
  }

  /**
   * Called on every quote/bar event for a symbol in this strategy's universe.
   * Computes the spread and z-score, then emits signals if thresholds are crossed.
   * @param context - EvaluationContext from the Orchestrator
   * @returns StrategySignal or null
   */
  evaluate(context: EvaluationContext): StrategySignal | null {
    if (!this.isActive || !this.pairsConfig.enabled) return null;
    if (this._debugEnabled) this._debug.evaluateCalls++;

    const { symbolState } = context;
    const { leg1Symbol, leg2Symbol } = this.pairsConfig;

    // Both legs must have recent data
    const s1 = symbolState.get(leg1Symbol);
    const s2 = symbolState.get(leg2Symbol);
    if (!s1 || !s2) {
      if (this._debugEnabled) this._debug.missingLegData++;
      return null;
    }

    const price1 = this.pairsConfig.priceSource === "mid"
      ? s1.latestMid
      : s1.latestTrade?.price ?? null;
    const price2 = this.pairsConfig.priceSource === "mid"
      ? s2.latestMid
      : s2.latestTrade?.price ?? null;

    if (price1 === null || price2 === null) {
      if (this._debugEnabled) this._debug.missingPrices++;
      return null;
    }
    this.state.latestLeg1Price = price1;

    // Feed price history windows for OLS hedge ratio estimation
    const ts = nowMs();
    this.state.olsLeg1Window.push({ ts, value: price1 });
    this.state.olsLeg2Window.push({ ts, value: price2 });
    this.state.barsSinceOlsRecalc++;

    const hedgeRatio = this._getHedgeRatio();

    // Compute spread and update window
    const spread = price1 - hedgeRatio * price2;
    this.state.spreadWindow.push({ ts, value: spread });
    this.state.lastSpread = spread;

    // Enforce cooldown
    if (this.state.cooldownActive && this.state.cooldownExpiresAt !== null) {
      if (ts < this.state.cooldownExpiresAt) {
        if (this._debugEnabled) this._debug.cooldownSuppressed++;
        return null;
      }
      this.state.cooldownActive = false;
      this.state.cooldownExpiresAt = null;
    }

    // Need enough observations
    const values = this.state.spreadWindow.getValues();
    if (values.length < this.pairsConfig.minObservations) {
      if (this._debugEnabled) this._debug.insufficientObservations++;
      return null;
    }

    // Compute z-score
    const zResult = computeZScore(values);
    if (zResult === null) {
      if (this._debugEnabled) this._debug.zScoreNull++;
      return null;
    }
    const { zScore, mean, std } = zResult;
    this.state.lastZScore = zScore;
    this.state.currentHedgeRatio = hedgeRatio;

    // ---- Exit logic (checked before entry) ----
    const signal = this._checkExitSignals(zScore, mean, std, spread, ts, leg1Symbol, leg2Symbol)
      ?? this._checkEntrySignals(zScore, mean, std, spread, ts, leg1Symbol, leg2Symbol);

    if (this._debugEnabled) {
      if (signal) {
        if (signal.direction === "long" || signal.direction === "short") this._debug.entrySignals++;
        else this._debug.exitSignals++;
      } else {
        this._debug.noSignal++;
      }
    }

    return signal;
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private _getHedgeRatio(): number {
    if (this.pairsConfig.hedgeRatioMethod === "fixed") {
      return this.pairsConfig.fixedHedgeRatio;
    }

    // Only recompute every olsRecalcIntervalBars to avoid unnecessary work
    if (this.state.barsSinceOlsRecalc < this.pairsConfig.olsRecalcIntervalBars) {
      return this.state.currentHedgeRatio;
    }
    this.state.barsSinceOlsRecalc = 0;

    const leg1Prices = this.state.olsLeg1Window.getValues();
    const leg2Prices = this.state.olsLeg2Window.getValues();
    const result = computeOLSHedgeRatio(leg1Prices, leg2Prices);

    if (result === null) {
      return this.state.currentHedgeRatio;
    }

    if (result.rSquared < 0.5) {
      logger.warn("PairsStrategy: low OLS R² — pair may not be cointegrated", {
        id: this.id,
        rSquared: result.rSquared.toFixed(3),
      });
    }

    this.state.currentHedgeRatio = result.beta;
    return result.beta;
  }

  private _checkExitSignals(
    zScore: number,
    mean: number,
    std: number,
    spread: number,
    ts: number,
    leg1: string,
    leg2: string,
  ): StrategySignal | null {
    const { positionState, positionOpenedAt } = this.state;
    if (positionState === "flat") return null;

    const absZ = Math.abs(zScore);

    // Stop-loss: z-score moved too far against us
    if (absZ >= this.pairsConfig.stopLossZScore) {
      return this._buildExitSignal(leg1, zScore, mean, std, spread, "stop_loss");
    }

    // Max holding time exceeded
    if (positionOpenedAt !== null && ts - positionOpenedAt >= this.pairsConfig.maxHoldingTimeMs) {
      return this._buildExitSignal(leg1, zScore, mean, std, spread, "max_hold_exit");
    }

    // Normal exit: spread reverted to near mean
    if (absZ <= this.pairsConfig.exitZScore) {
      return this._buildExitSignal(leg1, zScore, mean, std, spread, "exit");
    }

    return null;
  }

  private _checkEntrySignals(
    zScore: number,
    mean: number,
    std: number,
    spread: number,
    ts: number,
    leg1: string,
    leg2: string,
  ): StrategySignal | null {
    if (this.state.positionState !== "flat") return null;

    const { entryZScore } = this.pairsConfig;

    if (zScore <= -entryZScore) {
      // Spread unusually LOW → enter long spread (buy leg1, sell leg2)
      return this._buildEntrySignal("long_spread", leg1, leg2, zScore, mean, std, spread);
    }

    if (zScore >= entryZScore) {
      // Spread unusually HIGH → enter short spread (sell leg1, buy leg2)
      return this._buildEntrySignal("short_spread", leg1, leg2, zScore, mean, std, spread);
    }

    return null;
  }

  private _buildEntrySignal(
    direction: "long_spread" | "short_spread",
    leg1: string,
    leg2: string,
    zScore: number,
    mean: number,
    std: number,
    spread: number,
  ): StrategySignal {
    const isLong = direction === "long_spread";
    const leg1Direction = isLong ? "long" : "short";
    const leg2Direction = isLong ? "short" : "long";

    this.state.positionState = direction;
    this.state.positionOpenedAt = nowMs();

    logger.info("PairsStrategy: entry signal", {
      id: this.id,
      direction,
      zScore: zScore.toFixed(3),
      spread: spread.toFixed(4),
    });

    const meta: PairsSignalMeta = {
      zScore,
      spread,
      spreadMean: mean,
      spreadStd: std,
      hedgeRatio: this.state.currentHedgeRatio,
      signalType: isLong ? "entry_long" : "entry_short",
      counterpartSymbol: leg2,
      counterpartDirection: leg2Direction,
    };

    // Signal is for leg1; execution layer will create a paired leg2 order from meta
    return this.buildSignal({
      symbol: leg1,
      direction: leg1Direction,
      qty: this._computeQty(),
      triggerValue: zScore,
      triggerLabel: isLong ? "z_score_entry_long" : "z_score_entry_short",
      meta: meta as unknown as Record<string, unknown>,
    });
  }

  private _buildExitSignal(
    leg1: string,
    zScore: number,
    mean: number,
    std: number,
    spread: number,
    signalType: "exit" | "stop_loss" | "max_hold_exit",
  ): StrategySignal {
    const isLong = this.state.positionState === "long_spread";
    const exitDirection = isLong ? "close_long" : "close_short";

    this.state.positionState = "flat";
    this.state.positionOpenedAt = null;
    this.state.completedTrades++;

    // Activate cooldown
    this.state.cooldownActive = true;
    this.state.cooldownExpiresAt = nowMs() + this.pairsConfig.cooldownMs;

    logger.info("PairsStrategy: exit signal", {
      id: this.id,
      signalType,
      zScore: zScore.toFixed(3),
    });

    const meta: PairsSignalMeta = {
      zScore,
      spread,
      spreadMean: mean,
      spreadStd: std,
      hedgeRatio: this.state.currentHedgeRatio,
      signalType,
      counterpartSymbol: this.pairsConfig.leg2Symbol,
      counterpartDirection: isLong ? "close_short" : "close_long",
    };

    return this.buildSignal({
      symbol: leg1,
      direction: exitDirection,
      qty: this._computeQty(),
      triggerValue: zScore,
      triggerLabel: `z_score_${signalType}`,
      meta: meta as unknown as Record<string, unknown>,
    });
  }

  private _computeQty(): number {
    const price = this.state.latestLeg1Price;
    if (!price || price <= 0) return 0;
    return Math.floor(this.pairsConfig.tradeNotionalUsd / price);
  }

  private _initState(): PairsInternalState {
    return {
      positionState: "flat",
      positionOpenedAt: null,
      lastZScore: null,
      lastSpread: null,
      spreadWindow: new RollingTimeWindow(this.pairsConfig.rollingWindowMs),
      currentHedgeRatio: this.pairsConfig.fixedHedgeRatio,
      completedTrades: 0,
      cooldownActive: false,
      cooldownExpiresAt: null,
      latestLeg1Price: null,
      olsLeg1Window: new RollingTimeWindow(this.pairsConfig.olsWindowMs),
      olsLeg2Window: new RollingTimeWindow(this.pairsConfig.olsWindowMs),
      barsSinceOlsRecalc: 0,
    };
  }

  /**
   * Prints accumulated debug counters. Only meaningful when BACKTEST_DEBUG=1.
   * Call after the backtest run completes.
   */
  printDebugCounters(): void {
    if (!this._debugEnabled) {
      console.log("PairsStrategy debug counters: BACKTEST_DEBUG not set, no data collected.");
      return;
    }
    console.log("\n=== PairsStrategy Signal Funnel ===");
    console.log(`  evaluate() calls:         ${this._debug.evaluateCalls}`);
    console.log(`  ├─ missing leg data:       ${this._debug.missingLegData}`);
    console.log(`  ├─ missing prices:         ${this._debug.missingPrices}`);
    console.log(`  ├─ cooldown suppressed:    ${this._debug.cooldownSuppressed}`);
    console.log(`  ├─ insufficient obs:       ${this._debug.insufficientObservations}`);
    console.log(`  ├─ zScore null:            ${this._debug.zScoreNull}`);
    console.log(`  ├─ no signal (z in range): ${this._debug.noSignal}`);
    console.log(`  ├─ entry signals emitted:  ${this._debug.entrySignals}`);
    console.log(`  └─ exit signals emitted:   ${this._debug.exitSignals}`);
    console.log(`  completedTrades (state):   ${this.state.completedTrades}`);
    console.log();
  }
}
