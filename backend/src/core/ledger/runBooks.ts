/**
 * core/ledger/runBooks.ts
 *
 * One book per run this runtime trades. The shared portfolio book nets every
 * strategy's positions per symbol, so it cannot say how any one run is doing;
 * these are fed only the fills carrying a run's id and are sampled into
 * run_snapshots, which become the run's equity curve.
 */

import { PortfolioStateManager } from "../state/portfolioState";
import type { Fill } from "../../types/orders";
import type { RunSnapshotInsert } from "../../adapters/supabase/analyticsRepository";

export class RunBooks {
  private readonly books = new Map<string, PortfolioStateManager>();

  private book(runId: string): PortfolioStateManager {
    let b = this.books.get(runId);
    if (!b) {
      // Cash is not tracked per run (capital is shared); PnL and exposure are.
      b = new PortfolioStateManager(0);
      this.books.set(runId, b);
    }
    return b;
  }

  applyFill(runId: string, fill: Fill): void {
    this.book(runId).applyFill(fill);
  }

  updatePrice(symbol: string, price: number): void {
    for (const b of this.books.values()) {
      if (b.getPosition(symbol)) b.updatePrice(symbol, price);
    }
  }

  has(runId: string): boolean {
    return this.books.has(runId);
  }

  drop(runId: string): void {
    this.books.delete(runId);
  }

  /** Samples the given runs' books; books for runs not listed are dropped. */
  snapshot(heldRunIds: string[], ts: number): RunSnapshotInsert[] {
    const held = new Set(heldRunIds);
    for (const id of [...this.books.keys()]) if (!held.has(id)) this.books.delete(id);
    const rows: RunSnapshotInsert[] = [];
    for (const runId of held) {
      const s = this.book(runId).getSnapshot();
      rows.push({
        runId,
        ts,
        realizedPnl: s.totalRealizedPnl,
        unrealizedPnl: s.totalUnrealizedPnl,
        grossExposure: s.positions.reduce((a, p) => a + Math.abs(p.marketValue), 0),
        netExposure: s.positions.reduce((a, p) => a + p.marketValue, 0),
        positions: s.positions.map((p) => ({ symbol: p.symbol, qty: p.qty, avgEntryPrice: p.avgEntryPrice, currentPrice: p.currentPrice })),
      });
    }
    return rows;
  }
}
