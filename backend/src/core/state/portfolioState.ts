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
  private totalCommissions = 0;

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

    // Deduct commission from cash AND track in realized P&L
    this.cash -= fill.commission;
    this.totalCommissions += fill.commission;
    this.totalRealizedPnl -= fill.commission; // Net realized PnL includes costs
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
    
    if (position.qty > 0) {
      // Long position
      position.unrealizedPnl = (currentPrice - position.avgEntryPrice) * position.qty;
    } else {
      // Short position
      position.unrealizedPnl = (position.avgEntryPrice - currentPrice) * Math.abs(position.qty);
    }

    position.unrealizedPnlPct =
      position.costBasis !== 0 ? position.unrealizedPnl / Math.abs(position.costBasis) : 0;
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
      returnPct: (equity - this.initialCapital) / this.initialCapital,
      positions,
      positionCount: positions.length,
    };
  }

  /** Clears all positions and resets cash to initial capital. Used in tests. */
  reset(): void {
    this.positions.clear();
    this.cash = this.initialCapital;
    this.totalRealizedPnl = 0;
    this.totalCommissions = 0;
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
      if (existing.qty < 0) {
        // Covering a short: realize PnL
        const qtyToClose = Math.min(fill.qty, Math.abs(existing.qty));
        const pnl = (existing.avgEntryPrice - fill.price) * qtyToClose;
        
        existing.realizedPnl += pnl;
        this.totalRealizedPnl += pnl;

        existing.qty += fill.qty; // Moves closer to zero or becomes positive

        if (existing.qty > 0) {
          // Crossed from short to long: update entry price to the price of the new portion
          existing.avgEntryPrice = fill.price;
        }
      } else {
        // Increasing a long
        const totalQty = existing.qty + fill.qty;
        existing.avgEntryPrice =
          (existing.avgEntryPrice * existing.qty + fill.price * fill.qty) / totalQty;
        existing.qty = totalQty;
      }

      if (existing.qty === 0) {
        this.positions.delete(fill.symbol);
      } else {
        existing.costBasis = existing.avgEntryPrice * existing.qty;
        existing.marketValue = fill.price * existing.qty;
        existing.updatedAt = fill.ts;
        // Re-calculate unrealized PnL immediately after qty change
        this.updatePrice(fill.symbol, fill.price);
      }
    }
  }

  private _applySell(fill: Fill, existing: Position | undefined): void {
    const proceeds = fill.qty * fill.price;
    this.cash += proceeds;

    if (!existing) {
      // Opening a new short position
      const position: Position = {
        id: newId() as UUID,
        symbol: fill.symbol,
        qty: -fill.qty,
        avgEntryPrice: fill.price,
        currentPrice: fill.price,
        marketValue: -proceeds,
        unrealizedPnl: 0,
        unrealizedPnlPct: 0,
        realizedPnl: 0,
        costBasis: -proceeds,
        openedAt: fill.ts,
        updatedAt: fill.ts,
        strategyId: undefined,
      };
      this.positions.set(fill.symbol, position);
    } else {
      if (existing.qty > 0) {
        // Closing a long: realize PnL
        const qtyToClose = Math.min(fill.qty, existing.qty);
        const pnl = (fill.price - existing.avgEntryPrice) * qtyToClose;
        
        existing.realizedPnl += pnl;
        this.totalRealizedPnl += pnl;

        existing.qty -= fill.qty; // Moves closer to zero or becomes negative

        if (existing.qty < 0) {
          // Crossed from long to short: update entry price to the price of the new portion
          existing.avgEntryPrice = fill.price;
        }
      } else {
        // Increasing a short (qty is already negative)
        const totalQty = existing.qty - fill.qty;
        existing.avgEntryPrice =
          (existing.avgEntryPrice * Math.abs(existing.qty) + fill.price * fill.qty) / Math.abs(totalQty);
        existing.qty = totalQty;
      }

      if (existing.qty === 0) {
        this.positions.delete(fill.symbol);
      } else {
        existing.costBasis = existing.avgEntryPrice * existing.qty;
        existing.marketValue = fill.price * existing.qty;
        existing.updatedAt = fill.ts;
        // Re-calculate unrealized PnL immediately after qty change
        this.updatePrice(fill.symbol, fill.price);
      }
    }
  }
}
