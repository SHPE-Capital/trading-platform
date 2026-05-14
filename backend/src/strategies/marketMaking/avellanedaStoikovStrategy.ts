/**
 * strategies/marketMaking/avellanedaStoikovStrategy.ts
 *
 * Avellaneda-Stoikov inventory-aware market making strategy.
 *
 * Algorithm (Avellaneda & Stoikov 2008, "High-frequency trading in a
 * limit order book"):
 *
 *   1. Observe the latest mid price s and current inventory q (signed
 *      shares held in the symbol). q > 0 means long, q < 0 means short.
 *   2. Estimate a short-term realized volatility σ from recent mid-price
 *      returns (sample std-dev or EWMA, configurable).
 *   3. Compute the time-to-close T - t in fractional units of the
 *      configured horizon.
 *   4. Reservation price:
 *          r = s − (q − q_target) · γ · σ² · (T − t)
 *      Skews the fair value away from the mid in the direction that
 *      reduces inventory: long inventory ⇒ r < s ⇒ sell side gets a
 *      better price, buy side gets pushed further away.
 *   5. Optimal half-spread (δ):
 *          δ = ½ · ( γ · σ² · (T − t) + (2/γ) · ln(1 + γ/κ) )
 *      The first term scales with risk × variance × horizon; the second
 *      term is the κ/γ "intensity" component that does not vanish near
 *      horizon end.
 *   6. Quote bid at  r − δ  and ask at  r + δ, snapped to tick size,
 *      clamped to [minHalfSpread, maxHalfSpread] on either side of r.
 *   7. Suppress the buy side when inventory ≥ +inventoryLimit, suppress
 *      the sell side when inventory ≤ -inventoryLimit, suppress both
 *      when σ exceeds killSwitchSigma or |q| exceeds the kill-switch
 *      multiplier.
 *   8. Emit a single StrategySignal carrying both quotes in
 *      `meta.makerQuotes`. The orchestrator translates this into two
 *      paired limit OrderIntents (one bid buy, one ask sell).
 *
 * No-lookahead guarantee: the strategy reads only the latest mid
 * available in symbol state (already pushed by the orchestrator before
 * evaluate() is called) and the strategy's own rolling window of prior
 * mids. It never peeks at future bars.
 *
 * Cooldown / refresh: a single quoteRefreshMs gate prevents the
 * strategy from re-emitting on every tick when many ticks arrive within
 * one refresh interval. Existing resting orders are not canceled by
 * this strategy directly — that is the OMS's responsibility — but a
 * realistic backtest of true market making would also need cancel-on-
 * refresh and queue-position modeling (see docs).
 *
 * Inputs:  EvaluationContext with symbol/portfolio state.
 * Outputs: StrategySignal with MakerQuotesMeta, or null.
 */

import { BaseStrategy } from "../base/strategy";
import { RollingTimeWindow } from "../../core/state/rollingWindow";
import { logger } from "../../utils/logger";
import { nowMs } from "../../utils/time";
import type { EvaluationContext } from "../base/strategy";
import type { StrategySignal, StrategyType } from "../../types/strategy";
import type {
  AvellanedaStoikovConfig,
  AvellanedaStoikovInternalState,
  MakerQuote,
  MakerQuotesMeta,
} from "./avellanedaStoikovTypes";

export class AvellanedaStoikovStrategy extends BaseStrategy {
  readonly type: StrategyType = "market_making";

  private readonly state: AvellanedaStoikovInternalState;

  /** Debug counters; populated when BACKTEST_DEBUG=1 */
  private readonly _debugEnabled = process.env.BACKTEST_DEBUG === "1";
  private readonly _debug = {
    evaluateCalls: 0,
    insufficientObservations: 0,
    invalidMid: 0,
    cooldownSuppressed: 0,
    killSwitchSuppressed: 0,
    twoSidedQuotes: 0,
    oneSidedQuotes: 0,
    noQuote: 0,
  };

  /**
   * @param asConfig - Full validated AvellanedaStoikovConfig (use
   *                   createAvellanedaStoikovConfig to construct one).
   */
  constructor(readonly asConfig: AvellanedaStoikovConfig) {
    // BaseStrategy expects BaseStrategyConfig — AvellanedaStoikovConfig
    // is a superset of the required shape.
    super(asConfig as never);
    this.state = this._initState();
  }

  /** Called by the orchestrator when the strategy is activated. */
  override start(): void {
    super.start();
    this.state.startedAtMs = nowMs();
  }

  /**
   * Called on every market data event for this strategy's symbol.
   * Emits at most one StrategySignal per call. The signal's
   * `meta.makerQuotes` carries the two-sided quote payload that the
   * orchestrator translates into paired limit orders.
   */
  evaluate(context: EvaluationContext): StrategySignal | null {
    if (!this.isActive || !this.asConfig.enabled) return null;
    if (context.symbol !== this.asConfig.symbol) return null;
    if (this._debugEnabled) this._debug.evaluateCalls++;

    const { symbolState, portfolioState } = context;
    const symState = symbolState.get(this.asConfig.symbol);
    if (!symState) {
      if (this._debugEnabled) this._debug.noQuote++;
      return null;
    }

    const mid = symState.latestMid;
    if (mid === null || !Number.isFinite(mid) || mid <= 0) {
      if (this._debugEnabled) this._debug.invalidMid++;
      return null;
    }

    // Track mid in the strategy's own returns window. We deliberately
    // do NOT reuse symbolState.midpricesWindow because its window length
    // is shared across strategies and may not match volWindowSize.
    const ts = nowMs();
    this._pushMid(mid, ts);

    // Cooldown gate based on quoteRefreshMs
    if (this.state.lastQuoteTs !== null) {
      if (ts - this.state.lastQuoteTs < this.asConfig.quoteRefreshMs) {
        if (this._debugEnabled) this._debug.cooldownSuppressed++;
        return null;
      }
    }

    // Need enough observations to estimate σ
    if (this.state.midObservations < this.asConfig.minObservations) {
      if (this._debugEnabled) this._debug.insufficientObservations++;
      return null;
    }

    // Current inventory (signed shares) from portfolio state
    const position = portfolioState.getPosition(this.asConfig.symbol);
    const inventory = position?.qty ?? 0;

    // Volatility estimate (per-bar return units)
    const sigma = this._estimateSigma();

    // Kill-switch checks
    const inventoryKill =
      Math.abs(inventory) >=
      this.asConfig.inventoryLimit * this.asConfig.killSwitchInventoryMult;
    if (sigma >= this.asConfig.killSwitchSigma || inventoryKill) {
      this.state.killSwitchActivations++;
      if (this._debugEnabled) this._debug.killSwitchSuppressed++;
      return this._emitKillSwitchSignal(mid, sigma, inventory, ts);
    }

    // Time-to-close as a fraction of horizonMs
    const ttc = this._timeToCloseFraction(ts);

    // Reservation price and optimal half-spread
    const q = inventory - this.asConfig.inventoryTarget;
    const sigma2 = sigma * sigma;
    const reservationPrice = mid - q * this.asConfig.gamma * sigma2 * ttc;

    const halfSpreadRaw =
      0.5 *
      (this.asConfig.gamma * sigma2 * ttc +
        (2 / this.asConfig.gamma) *
          Math.log(1 + this.asConfig.gamma / this.asConfig.kappa));
    const halfSpread = Math.min(
      this.asConfig.maxHalfSpread,
      Math.max(this.asConfig.minHalfSpread, halfSpreadRaw),
    );

    // Build candidate quotes (price-snapped to tick size)
    const bidPriceRaw = reservationPrice - halfSpread;
    const askPriceRaw = reservationPrice + halfSpread;
    const bidPrice = this._snapDown(bidPriceRaw);
    const askPrice = this._snapUp(askPriceRaw);

    // Enforce strict bid < ask after snapping (degenerate when halfSpread
    // is tiny vs tickSize). If they collide, push them one tick apart.
    let finalBid = bidPrice;
    let finalAsk = askPrice;
    if (finalAsk - finalBid < this.asConfig.tickSize) {
      finalAsk = finalBid + this.asConfig.tickSize;
    }

    // Inventory caps: suppress the side that would worsen inventory
    let suppression: MakerQuotesMeta["suppression"] | undefined;
    let postBid = true;
    let postAsk = true;
    if (inventory >= this.asConfig.inventoryLimit) {
      postBid = false;
      suppression = "inventory_cap_long";
    }
    if (inventory <= -this.asConfig.inventoryLimit) {
      postAsk = false;
      suppression = "inventory_cap_short";
    }

    const qty = Math.min(this.asConfig.maxQuoteQty, this.asConfig.baseOrderQty);
    const makerQuotes: MakerQuote[] = [];
    if (postBid && finalBid > 0) makerQuotes.push({ side: "buy", price: finalBid, qty });
    if (postAsk && finalAsk > 0) makerQuotes.push({ side: "sell", price: finalAsk, qty });

    if (makerQuotes.length === 0) {
      if (this._debugEnabled) this._debug.noQuote++;
      this.state.lastQuoteTs = ts;
      return null;
    }

    this.state.lastQuoteTs = ts;
    this.state.lastReservationPrice = reservationPrice;
    this.state.lastHalfSpread = halfSpread;
    this.state.lastSigma = sigma;
    this.state.quoteEmissions++;

    if (this._debugEnabled) {
      if (makerQuotes.length === 2) this._debug.twoSidedQuotes++;
      else this._debug.oneSidedQuotes++;
    }

    const meta: MakerQuotesMeta = {
      kind: "maker_quotes",
      makerQuotes,
      timeInForce: "day",
      reservationPrice,
      halfSpread,
      sigma,
      inventory,
      midPrice: mid,
      suppression,
    };

    return this.buildSignal({
      symbol: this.asConfig.symbol,
      direction: "flat",
      // qty at the top-level is informational only; the orchestrator
      // uses per-leg qty from meta.makerQuotes. We set it to total quoted
      // size for downstream observability.
      qty: makerQuotes.reduce((s, q2) => s + q2.qty, 0),
      triggerValue: reservationPrice,
      triggerLabel: "as_quote",
      meta: meta as unknown as Record<string, unknown>,
    });
  }

  // ------------------------------------------------------------------
  // Diagnostics
  // ------------------------------------------------------------------

  /** Returns a shallow snapshot of the internal state for tests / UI. */
  getInternalSnapshot(): {
    midObservations: number;
    lastSigma: number | null;
    lastReservationPrice: number | null;
    lastHalfSpread: number | null;
    quoteEmissions: number;
    killSwitchActivations: number;
  } {
    return {
      midObservations: this.state.midObservations,
      lastSigma: this.state.lastSigma,
      lastReservationPrice: this.state.lastReservationPrice,
      lastHalfSpread: this.state.lastHalfSpread,
      quoteEmissions: this.state.quoteEmissions,
      killSwitchActivations: this.state.killSwitchActivations,
    };
  }

  /** Prints accumulated debug counters when BACKTEST_DEBUG=1. */
  printDebugCounters(): void {
    if (!this._debugEnabled) {
      console.log(
        "AvellanedaStoikovStrategy debug counters: BACKTEST_DEBUG not set.",
      );
      return;
    }
    console.log("\n=== AvellanedaStoikov Signal Funnel ===");
    console.log(`  evaluate() calls:           ${this._debug.evaluateCalls}`);
    console.log(`  ├─ invalid mid:              ${this._debug.invalidMid}`);
    console.log(`  ├─ insufficient obs:         ${this._debug.insufficientObservations}`);
    console.log(`  ├─ cooldown suppressed:      ${this._debug.cooldownSuppressed}`);
    console.log(`  ├─ kill-switch suppressed:   ${this._debug.killSwitchSuppressed}`);
    console.log(`  ├─ two-sided quotes emitted: ${this._debug.twoSidedQuotes}`);
    console.log(`  ├─ one-sided quotes emitted: ${this._debug.oneSidedQuotes}`);
    console.log(`  └─ no quote:                 ${this._debug.noQuote}`);
    console.log();
  }

  // ------------------------------------------------------------------
  // Private — formula helpers
  // ------------------------------------------------------------------

  /**
   * Returns (T - t) / horizonMs in [minHorizonFraction, 1].
   * If startedAtMs is unset (start() not called) returns 1 so the
   * strategy still produces quotes when invoked in unit tests.
   */
  private _timeToCloseFraction(nowTs: number): number {
    if (this.state.startedAtMs === null) return 1;
    const elapsed = nowTs - this.state.startedAtMs;
    const remaining = this.asConfig.horizonMs - elapsed;
    let frac = remaining / this.asConfig.horizonMs;
    if (!Number.isFinite(frac)) frac = 1;
    if (frac > 1) frac = 1;
    if (this.asConfig.clampHorizon) {
      if (frac < this.asConfig.minHorizonFraction) {
        frac = this.asConfig.minHorizonFraction;
      }
    } else if (frac < 0) {
      frac = 0;
    }
    return frac;
  }

  private _pushMid(mid: number, ts: number): void {
    // Update EWMA variance against the previous mid before pushing.
    if (
      this.asConfig.volEstimator === "ewma_returns" &&
      this.state.lastMid !== null &&
      this.state.lastMid > 0
    ) {
      const ret = Math.log(mid / this.state.lastMid);
      const lambda = this.asConfig.volEwmaLambda;
      const prevVar = this.state.ewmaVariance ?? ret * ret;
      this.state.ewmaVariance = lambda * prevVar + (1 - lambda) * ret * ret;
    }
    this.state.lastMid = mid;
    this.state.midObservations++;
    this.state.midWindow.push({ ts, value: mid });
  }

  private _estimateSigma(): number {
    let sigma: number;
    if (this.asConfig.volEstimator === "ewma_returns") {
      const variance = this.state.ewmaVariance ?? 0;
      sigma = Math.sqrt(Math.max(variance, 0));
    } else {
      sigma = this._sampleStdDevReturns();
    }
    if (!Number.isFinite(sigma)) sigma = this.asConfig.sigmaFloor;
    if (sigma < this.asConfig.sigmaFloor) sigma = this.asConfig.sigmaFloor;
    if (sigma > this.asConfig.sigmaCap) sigma = this.asConfig.sigmaCap;
    return sigma;
  }

  private _sampleStdDevReturns(): number {
    const all = this.state.midWindow.getValues();
    if (all.length < 2) return this.asConfig.sigmaFloor;
    // Restrict to the most recent volWindowSize observations so the σ
    // estimator behaves like a count-based window even though the
    // underlying store is time-bounded.
    const window = this.asConfig.volWindowSize + 1;
    const values = all.length > window ? all.slice(all.length - window) : all;
    const returns: number[] = [];
    for (let i = 1; i < values.length; i++) {
      const prev = values[i - 1];
      const cur = values[i];
      if (prev > 0 && cur > 0) returns.push(Math.log(cur / prev));
    }
    if (returns.length < 1) return this.asConfig.sigmaFloor;
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance =
      returns.reduce((s, r) => s + (r - mean) * (r - mean), 0) /
      Math.max(1, returns.length - 1);
    return Math.sqrt(variance);
  }

  /** Snaps a price down to the nearest tick boundary (for bid quotes). */
  private _snapDown(price: number): number {
    return Math.floor(price / this.asConfig.tickSize) * this.asConfig.tickSize;
  }

  /** Snaps a price up to the nearest tick boundary (for ask quotes). */
  private _snapUp(price: number): number {
    return Math.ceil(price / this.asConfig.tickSize) * this.asConfig.tickSize;
  }

  private _emitKillSwitchSignal(
    mid: number,
    sigma: number,
    inventory: number,
    ts: number,
  ): StrategySignal {
    this.state.lastQuoteTs = ts;
    this.state.lastSigma = sigma;
    logger.warn("AvellanedaStoikov: kill-switch active — quotes suppressed", {
      id: this.id,
      sigma,
      inventory,
      inventoryLimit: this.asConfig.inventoryLimit,
    });
    const meta: MakerQuotesMeta = {
      kind: "maker_quotes",
      makerQuotes: [],
      timeInForce: "day",
      reservationPrice: mid,
      halfSpread: 0,
      sigma,
      inventory,
      midPrice: mid,
      suppression: "kill_switch",
    };
    return this.buildSignal({
      symbol: this.asConfig.symbol,
      direction: "flat",
      qty: 0,
      triggerValue: sigma,
      triggerLabel: "as_kill_switch",
      meta: meta as unknown as Record<string, unknown>,
    });
  }

  private _initState(): AvellanedaStoikovInternalState {
    return {
      midWindow: new RollingTimeWindow<number>(this.asConfig.rollingWindowMs),
      midObservations: 0,
      lastQuoteTs: null,
      lastReservationPrice: null,
      lastHalfSpread: null,
      lastSigma: null,
      ewmaVariance: null,
      lastMid: null,
      startedAtMs: null,
      quoteEmissions: 0,
      killSwitchActivations: 0,
    };
  }
}
