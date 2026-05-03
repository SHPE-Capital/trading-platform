/**
 * core/risk/riskEngine.ts
 *
 * Risk management engine. Validates every OrderIntent before it reaches
 * the execution layer. Any check failure blocks the order and triggers
 * a RISK_REJECTED event on the EventBus.
 *
 * Inputs:  OrderIntent, current PortfolioSnapshot, RiskConfig.
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
   * @param intent - The OrderIntent to validate
   * @param portfolio - Current PortfolioSnapshot for exposure checks
   * @returns RiskCheckResult indicating pass or fail with reason
   */
  check(intent: OrderIntent, portfolio: PortfolioSnapshot): RiskCheckResult {
    const ts = nowMs();

    const checks = [
      () => this._checkKillSwitch(intent),
      () => this._checkCooldown(intent, ts),
      () => this._checkMaxPositionSize(intent, portfolio),
      () => this._checkMaxNotionalExposure(intent, portfolio),
      () => this._checkShortSelling(intent, portfolio),
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

  // ------------------------------------------------------------------
  // Private checks — return { failedCheck, reason } on failure, null on pass
  // ------------------------------------------------------------------

  private _checkKillSwitch(intent: OrderIntent): { failedCheck: string; reason: string } | null {
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
  ): { failedCheck: string; reason: string } | null {
    const existingPosition = portfolio.positions.find((p) => p.symbol === intent.symbol);
    const existingNotional = existingPosition ? existingPosition.marketValue : 0;
    // Use a rough estimate of entry price: last market value / qty or intent limitPrice
    const estimatedPrice = existingPosition?.currentPrice ?? intent.limitPrice ?? 0;
    if (estimatedPrice === 0) return null; // Can't check without a price estimate

    // New qty depends on side: Buy increases qty, Sell decreases qty.
    // intent.qty is always positive.
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
  ): { failedCheck: string; reason: string } | null {
    const estimatedPrice = intent.limitPrice ?? 0;
    if (estimatedPrice === 0) return null;

    const intentNotional = intent.qty * estimatedPrice;
    const existingPosition = portfolio.positions.find((p) => p.symbol === intent.symbol);
    const existingNotional = existingPosition ? existingPosition.qty * existingPosition.currentPrice : 0;

    // What would be the new notional for THIS symbol?
    const qtyDelta = intent.side === "buy" ? intent.qty : -intent.qty;
    const symbolNewNotional = ((existingPosition?.qty ?? 0) + qtyDelta) * (existingPosition?.currentPrice ?? estimatedPrice);

    // Total notional = (all other positions) + |symbolNewNotional|
    const otherPositionsNotional = portfolio.positions
      .filter((p) => p.symbol !== intent.symbol)
      .reduce((sum, p) => sum + Math.abs(p.qty * p.currentPrice), 0);

    const totalExposure = otherPositionsNotional + Math.abs(symbolNewNotional);

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
}
