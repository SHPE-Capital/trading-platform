/**
 * core/state/portfolioState.ts
 *
 * In-memory portfolio state manager. Maintains cash balance, open positions,
 * unrealized and realized PnL. Updated on every fill event. Provides
 * portfolio snapshots for the frontend and for periodic persistence.
 *
 * Inputs:  Fill events from the execution layer; price updates from symbol state.
 * Outputs: PortfolioSnapshot queried by API controllers and persisted to DB.
 */

import { nowMs, msToIso } from "../../utils/time";
import { newId } from "../../utils/ids";
import type { Position, PortfolioSnapshot } from "../../types/portfolio";
import type { Fill } from "../../types/orders";
import type { Symbol, UUID } from "../../types/common";

export class PortfolioStateManager {
  private cash: number;
  private readonly initialCapital: number;
  private positions: Map<Symbol, Position> = new Map();
  private totalRealizedPnl = 0;

  /**
   * Creates the portfolio state manager with an initial cash balance.
   * @param initialCapital - Starting cash balance in USD
   */
  constructor(initialCapital: number) {
    this.cash = initialCapital;
    this.initialCapital = initialCapital;
  }

  /**
   * Applies a fill event to the portfolio, updating positions and cash.
   * Handles both opening new positions and closing/reducing existing ones.
   * @param fill - Fill event from the execution layer
   */
  applyFill(fill: Fill): void {
    const position = this.positions.get(fill.symbol);

    if (fill.side === "buy") {
      this._applyBuy(fill, position);
    } else {
      this._applySell(fill, position);
    }

    // Deduct commission
    this.cash -= fill.commission;
  }

  /**
   * Updates the current market price for a position symbol.
   * Recalculates unrealized PnL and market value.
   * Called by the Orchestrator when quote/trade events arrive.
   * @param symbol - The symbol to update
   * @param currentPrice - Current market price (mid or last trade)
   */
  updatePrice(symbol: Symbol, currentPrice: number): void {
    const position = this.positions.get(symbol);
    if (!position) return;
    position.currentPrice = currentPrice;
    position.marketValue = position.qty * currentPrice;
    position.unrealizedPnl = (currentPrice - position.avgEntryPrice) * position.qty;
    position.unrealizedPnlPct =
      position.costBasis > 0 ? position.unrealizedPnl / position.costBasis : 0;
    position.updatedAt = nowMs();
  }

  /**
   * Returns the current open position for a symbol, or null if flat.
   * @param symbol - Ticker symbol
   * @returns Position or null
   */
  getPosition(symbol: Symbol): Position | null {
    return this.positions.get(symbol) ?? null;
  }

  /**
   * Returns all open positions.
   * @returns Array of Position objects
   */
  getAllPositions(): Position[] {
    return [...this.positions.values()];
  }

  /**
   * Returns the current cash balance.
   * @returns Cash in USD
   */
  getCash(): number {
    return this.cash;
  }

  /**
   * Builds and returns a full PortfolioSnapshot of the current state.
   * Used by API controllers and the periodic snapshot persister.
   * @returns PortfolioSnapshot
   */
  getSnapshot(): PortfolioSnapshot {
    const positions = this.getAllPositions();
    const positionsValue = positions.reduce((s, p) => s + p.marketValue, 0);
    const totalUnrealizedPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
    const equity = this.cash + positionsValue;
    const totalPnl = totalUnrealizedPnl + this.totalRealizedPnl;
    const ts = nowMs();

    return {
      id: newId(),
      ts,
      isoTs: msToIso(ts),
      cash: this.cash,
      positionsValue,
      equity,
      initialCapital: this.initialCapital,
      totalUnrealizedPnl,
      totalRealizedPnl: this.totalRealizedPnl,
      totalPnl,
      returnPct: totalPnl / this.initialCapital,
      positions,
      positionCount: positions.length,
    };
  }

  /** Clears all positions and resets cash to initial capital. Used in tests. */
  reset(): void {
    this.positions.clear();
    this.cash = this.initialCapital;
    this.totalRealizedPnl = 0;
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  private _applyBuy(fill: Fill, existing: Position | undefined): void {
    const cost = fill.qty * fill.price;
    this.cash -= cost;

    if (!existing) {
      const position: Position = {
        id: newId() as UUID,
        symbol: fill.symbol,
        qty: fill.qty,
        avgEntryPrice: fill.price,
        currentPrice: fill.price,
        marketValue: cost,
        unrealizedPnl: 0,
        unrealizedPnlPct: 0,
        realizedPnl: 0,
        costBasis: cost,
        openedAt: fill.ts,
        updatedAt: fill.ts,
        strategyId: undefined,
      };
      this.positions.set(fill.symbol, position);
    } else {
      // Increase existing long position (weighted avg entry price)
      const totalQty = existing.qty + fill.qty;
      existing.avgEntryPrice =
        (existing.avgEntryPrice * existing.qty + fill.price * fill.qty) / totalQty;
      existing.qty = totalQty;
      existing.costBasis = existing.avgEntryPrice * totalQty;
      existing.marketValue = fill.price * totalQty;
      existing.updatedAt = fill.ts;
    }
  }

  private _applySell(fill: Fill, existing: Position | undefined): void {
    if (!existing) return; // Selling without a position (shouldn't happen with risk checks)

    const proceeds = fill.qty * fill.price;
    this.cash += proceeds;

    const realizedPnl = (fill.price - existing.avgEntryPrice) * fill.qty;
    existing.realizedPnl += realizedPnl;
    this.totalRealizedPnl += realizedPnl;

    existing.qty -= fill.qty;

    if (existing.qty <= 0) {
      this.positions.delete(fill.symbol);
    } else {
      existing.costBasis = existing.avgEntryPrice * existing.qty;
      existing.marketValue = fill.price * existing.qty;
      existing.updatedAt = fill.ts;
    }
  }
}
