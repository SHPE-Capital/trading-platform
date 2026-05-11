/**
 * core/risk/riskEngine.ts
 *
 * Risk management engine. Validates every OrderIntent before it reaches
 * the execution layer. Any check failure blocks the order and triggers
 * a RISK_REJECTED event on the EventBus.
 *
 * Inputs:  OrderIntent, current PortfolioSnapshot, RiskConfig,
 *          optional referencePrice (current market price for the symbol).
 * Outputs: RiskCheckResult (passed or rejected with reason).
 */

import { nowMs } from "../../utils/time";
import { DEFAULT_RISK_CONFIG } from "../../config/defaults";
import type { RiskConfig, RiskCheckResult } from "../../types/risk";
import type { OrderIntent } from "../../types/orders";
import type { PortfolioSnapshot } from "../../types/portfolio";

export class RiskEngine {
  private config: RiskConfig;
  /** Per-strategy last order timestamp (for cooldown enforcement) */
  private lastOrderTs: Map<string, number> = new Map();
  /** Equity at the start of the current session (set on first check) */
  private sessionStartEquity: number | null = null;

  /**
   * Creates the risk engine with optional custom config.
   * Falls back to DEFAULT_RISK_CONFIG for any unspecified fields.
   * @param config - Partial or full RiskConfig override
   */
  constructor(config: Partial<RiskConfig> = {}) {
    this.config = { ...DEFAULT_RISK_CONFIG, ...config };
  }

  /**
   * Runs all risk checks against the given order intent.
   * Checks are run in order; the first failure short-circuits.
   *
   * For market orders (no `intent.limitPrice`), pass `referencePrice` to
   * enable notional / cash / concentration checks. Without it, those
   * checks fall back to the existing position's currentPrice or skip.
   *
   * @param intent - The OrderIntent to validate
   * @param portfolio - Current PortfolioSnapshot for exposure checks
   * @param referencePrice - Current market price for the symbol (optional)
   * @returns RiskCheckResult indicating pass or fail with reason
   */
  check(intent: OrderIntent, portfolio: PortfolioSnapshot, referencePrice?: number): RiskCheckResult {
    const ts = nowMs();

    // Initialize session-start equity on first check
    if (this.sessionStartEquity === null) {
      this.sessionStartEquity = portfolio.equity > 0 ? portfolio.equity : portfolio.initialCapital;
    }

    const checks = [
      () => this._checkKillSwitch(intent),
      () => this._checkCooldown(intent, ts),
      () => this._checkMaxPositionSize(intent, portfolio, referencePrice),
      () => this._checkMaxNotionalExposure(intent, portfolio, referencePrice),
      () => this._checkShortSelling(intent, portfolio),
      () => this._checkCashReserve(intent, portfolio, referencePrice),
      () => this._checkIntradayDrawdown(intent, portfolio),
      () => this._checkConcentration(intent, portfolio, referencePrice),
    ];

    for (const check of checks) {
      const result = check();
      if (result) {
        return { passed: false, intent, ...result, ts };
      }
    }

    // All checks passed — record timestamp for cooldown tracking
    this.lastOrderTs.set(intent.strategyId, ts);
    return { passed: true, intent, ts };
  }

  /**
   * Activates or deactivates the global kill switch.
   * When active, all orders are blocked immediately.
   * @param active - Whether to activate the kill switch
   */
  setKillSwitch(active: boolean): void {
    this.config.killSwitchActive = active;
  }

  /**
   * Returns the current risk configuration.
   * @returns RiskConfig
   */
  getConfig(): RiskConfig {
    return { ...this.config };
  }

  /**
   * Updates risk config at runtime (e.g. from a frontend control).
   * @param updates - Partial RiskConfig fields to update
   */
  updateConfig(updates: Partial<RiskConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Resets session-start equity, e.g. on a new trading session.
   */
  resetSession(): void {
    this.sessionStartEquity = null;
  }

  // ------------------------------------------------------------------
  // Private checks — return { failedCheck, reason } on failure, null on pass
  // ------------------------------------------------------------------

  private _resolveReferencePrice(
    intent: OrderIntent,
    portfolio: PortfolioSnapshot,
    referencePrice?: number,
  ): number | null {
    if (typeof intent.limitPrice === "number" && intent.limitPrice > 0) return intent.limitPrice;
    if (typeof referencePrice === "number" && Number.isFinite(referencePrice) && referencePrice > 0) {
      return referencePrice;
    }
    const existing = portfolio.positions.find((p) => p.symbol === intent.symbol);
    if (existing && existing.currentPrice > 0) return existing.currentPrice;
    return null;
  }

  private _checkKillSwitch(_intent: OrderIntent): { failedCheck: string; reason: string } | null {
    if (!this.config.killSwitchActive) return null;
    return { failedCheck: "KILL_SWITCH", reason: "Global kill switch is active — all orders blocked" };
  }

  private _checkCooldown(
    intent: OrderIntent,
    ts: number,
  ): { failedCheck: string; reason: string } | null {
    const last = this.lastOrderTs.get(intent.strategyId);
    if (last === undefined) return null;
    const elapsed = ts - last;
    if (elapsed < this.config.orderCooldownMs) {
      return {
        failedCheck: "ORDER_COOLDOWN",
        reason: `Order cooldown active — ${this.config.orderCooldownMs - elapsed}ms remaining for strategy ${intent.strategyId}`,
      };
    }
    return null;
  }

  private _checkMaxPositionSize(
    intent: OrderIntent,
    portfolio: PortfolioSnapshot,
    referencePrice?: number,
  ): { failedCheck: string; reason: string } | null {
    const existingPosition = portfolio.positions.find((p) => p.symbol === intent.symbol);
    const estimatedPrice = this._resolveReferencePrice(intent, portfolio, referencePrice);
    if (estimatedPrice === null) return null;

    const qtyDelta = intent.side === "buy" ? intent.qty : -intent.qty;
    const newQty = (existingPosition?.qty ?? 0) + qtyDelta;
    const newNotional = Math.abs(newQty * estimatedPrice);

    if (newNotional > this.config.maxPositionSizeUsd) {
      return {
        failedCheck: "MAX_POSITION_SIZE",
        reason: `Order would exceed max position size of $${this.config.maxPositionSizeUsd} for ${intent.symbol} (new notional: $${newNotional.toFixed(2)})`,
      };
    }
    return null;
  }

  private _checkMaxNotionalExposure(
    intent: OrderIntent,
    portfolio: PortfolioSnapshot,
    referencePrice?: number,
  ): { failedCheck: string; reason: string } | null {
    const estimatedPrice = this._resolveReferencePrice(intent, portfolio, referencePrice);
    if (estimatedPrice === null) return null;

    const existingPosition = portfolio.positions.find((p) => p.symbol === intent.symbol);
    const qtyDelta = intent.side === "buy" ? intent.qty : -intent.qty;
    const newSymbolQty = (existingPosition?.qty ?? 0) + qtyDelta;
    const newSymbolPrice = existingPosition?.currentPrice && existingPosition.currentPrice > 0
      ? existingPosition.currentPrice
      : estimatedPrice;
    const symbolNewNotional = Math.abs(newSymbolQty * newSymbolPrice);

    const otherPositionsNotional = portfolio.positions
      .filter((p) => p.symbol !== intent.symbol)
      .reduce((sum, p) => sum + Math.abs(p.qty * p.currentPrice), 0);

    const totalExposure = otherPositionsNotional + symbolNewNotional;

    if (totalExposure > this.config.maxNotionalExposureUsd) {
      return {
        failedCheck: "MAX_NOTIONAL_EXPOSURE",
        reason: `Order would exceed max notional exposure of $${this.config.maxNotionalExposureUsd} (new total: $${totalExposure.toFixed(2)})`,
      };
    }
    return null;
  }

  private _checkShortSelling(
    intent: OrderIntent,
    portfolio: PortfolioSnapshot,
  ): { failedCheck: string; reason: string } | null {
    if (this.config.allowShortSelling || intent.side !== "sell") return null;
    const position = portfolio.positions.find((p) => p.symbol === intent.symbol);
    const heldQty = position?.qty ?? 0;
    if (intent.qty > heldQty) {
      return {
        failedCheck: "SHORT_SELLING_DISALLOWED",
        reason: `Sell qty ${intent.qty} exceeds held qty ${heldQty} for ${intent.symbol} and short selling is disabled`,
      };
    }
    return null;
  }

  private _checkCashReserve(
    intent: OrderIntent,
    portfolio: PortfolioSnapshot,
    referencePrice?: number,
  ): { failedCheck: string; reason: string } | null {
    // Only buys consume cash; sells produce cash (we treat covers / short opens
    // conservatively as not consuming cash here, matching simulation behavior).
    if (intent.side !== "buy") return null;

    const estimatedPrice = this._resolveReferencePrice(intent, portfolio, referencePrice);
    if (estimatedPrice === null) return null;

    const estimatedCost = intent.qty * estimatedPrice;
    const reservePct = this.config.cashReservePct ?? 0;
    // Reserve floor is computed against equity, not cash, so positions held
    // in non-cash assets are reflected. Falls back to cash if equity is zero.
    const reserveBase = portfolio.equity > 0 ? portfolio.equity : portfolio.cash;
    const reserveFloor = reserveBase * reservePct;
    const availableCash = portfolio.cash - reserveFloor;

    if (estimatedCost > availableCash) {
      return {
        failedCheck: "CASH_RESERVE",
        reason: `Order cost $${estimatedCost.toFixed(2)} exceeds available cash $${availableCash.toFixed(2)} (cash=$${portfolio.cash.toFixed(2)}, reserve floor=$${reserveFloor.toFixed(2)})`,
      };
    }
    return null;
  }

  private _checkIntradayDrawdown(
    _intent: OrderIntent,
    portfolio: PortfolioSnapshot,
  ): { failedCheck: string; reason: string } | null {
    const limit = this.config.maxIntradayDrawdownPct;
    if (limit == null || !Number.isFinite(limit)) return null;
    if (this.sessionStartEquity == null || this.sessionStartEquity <= 0) return null;

    const drawdownPct = (this.sessionStartEquity - portfolio.equity) / this.sessionStartEquity;
    if (drawdownPct >= limit) {
      this.setKillSwitch(true);
      return {
        failedCheck: "INTRADAY_DRAWDOWN",
        reason: `Drawdown ${(drawdownPct * 100).toFixed(2)}% exceeds limit ${(limit * 100).toFixed(2)}% — kill switch engaged`,
      };
    }
    return null;
  }

  private _checkConcentration(
    intent: OrderIntent,
    portfolio: PortfolioSnapshot,
    referencePrice?: number,
  ): { failedCheck: string; reason: string } | null {
    const limit = this.config.maxConcentrationPct;
    if (limit == null || !Number.isFinite(limit)) return null;
    if (portfolio.equity <= 0) return null;

    const estimatedPrice = this._resolveReferencePrice(intent, portfolio, referencePrice);
    if (estimatedPrice === null) return null;

    const existing = portfolio.positions.find((p) => p.symbol === intent.symbol);
    const qtyDelta = intent.side === "buy" ? intent.qty : -intent.qty;
    const newSymbolValue = Math.abs(((existing?.qty ?? 0) + qtyDelta) * estimatedPrice);
    const concentrationPct = newSymbolValue / portfolio.equity;

    if (concentrationPct > limit) {
      return {
        failedCheck: "CONCENTRATION_LIMIT",
        reason: `Symbol ${intent.symbol} would be ${(concentrationPct * 100).toFixed(1)}% of portfolio (limit ${(limit * 100).toFixed(1)}%)`,
      };
    }
    return null;
  }
}
