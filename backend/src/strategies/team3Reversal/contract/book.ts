/**
 * strategies/team3Reversal/contract/book.ts
 *
 * Team 3's own book: its positions and real entry prices, built only from its
 * own orders' fills (bugs 11, 12).
 *
 * Why: portfolioState.getPosition() is the whole account's position, so other
 * strategies on the same symbol leak in, and the platform gives no fill callback.
 * So:
 *   1. when we emit a signal, markPending() remembers it (and its notional, so
 *      the gross cap counts it before it fills);
 *   2. fills happen at the next bar's open, before that bar's evaluate();
 *   3. on that bar, reconcile() finds our orders in orderState
 *      (strategyId === ours, same symbol, submitted at or after the signal bar)
 *      and applies their filled qty and average fill price.
 * An order that was never created, or filled nothing, is a contract violation:
 * it means the platform refused something we assumed it would accept.
 *
 * Owner: team lead.
 */

import type { OrderStateManager } from "../../../core/state/orderState";
import type { Order } from "../../../types/orders";
import { logger } from "../../../utils/logger";
import { newYorkDay } from "../session";

export interface Holding {
  /** Shares: positive long, negative short. */
  qty: number;
  /** Average fill price of the shares we hold. */
  entryPrice: number;
  /** When the opening fill happened (ms). */
  entryTs: number;
  /** Session decision bars since the entry filled. */
  barsHeld: number;
}

interface Pending {
  /** Start time of the bar we decided on; our order is submitted at its end. */
  sinceTs: number;
  /** Signed shares we asked for. */
  qty: number;
  price: number;
}

const OPEN = new Set(["submitted", "acknowledged", "partial_fill"]);

export class Team3Book {
  private readonly holdings = new Map<string, Holding>();
  private readonly pending = new Map<string, Pending>();
  private readonly applied = new Set<string>();
  /** Every time the platform did not do what CONTRACT.md says it does. Should stay empty. */
  readonly violations: string[] = [];

  constructor(private readonly strategyId: string) {}

  /** Our current holding in a symbol, or null if flat. */
  holding(symbol: string): Holding | null {
    return this.holdings.get(symbol) ?? null;
  }

  /** True while an order we sent for this symbol has not been reconciled yet. */
  hasPending(symbol: string): boolean {
    return this.pending.has(symbol);
  }

  /** Records a signal we just emitted: signed qty at the decision price. */
  markPending(symbol: string, sinceTs: number, signedQty: number, price: number): void {
    this.pending.set(symbol, { sinceTs, qty: signedQty, price });
  }

  /** Counts one more held session bar and returns the holding (null if flat). */
  tick(symbol: string): Holding | null {
    const h = this.holdings.get(symbol);
    if (h) h.barsHeld += 1;
    return h ?? null;
  }

  /** True when a holding's entry filled on an earlier New York day than `barTs`. */
  isFromEarlierDay(h: Holding, barTs: number): boolean {
    return newYorkDay(h.entryTs) !== newYorkDay(barTs);
  }

  /** Shares per symbol we are (or are about to be) exposed to: the larger of before and after each pending order. */
  *exposures(): Generator<[string, number]> {
    for (const s of new Set([...this.holdings.keys(), ...this.pending.keys()])) {
      const held = this.holdings.get(s)?.qty ?? 0;
      yield [s, Math.max(Math.abs(held), Math.abs(held + (this.pending.get(s)?.qty ?? 0)))];
    }
  }

  /** Applies our filled orders for this symbol; clears the pending flag once none are still working. */
  reconcile(symbol: string, orderState: OrderStateManager): void {
    const p = this.pending.get(symbol);
    if (!p) return;
    const ours = orderState.getAllOrders().filter(
      (o) => o.strategyId === this.strategyId && o.symbol === symbol && o.submittedAt >= p.sinceTs && !this.applied.has(o.id),
    );
    if (ours.some((o) => OPEN.has(o.status))) return;                       // still working: wait a bar
    const filled = ours.reduce((n, o) => n + o.filledQty, 0);
    if (filled === 0) this.violation(`${symbol}: order for ${p.qty} at ~${p.price} was not filled (${ours.map((o) => o.status).join(",") || "no order"})`);
    for (const o of ours) this.apply(o);
    this.pending.delete(symbol);
  }

  private apply(o: Order): void {
    this.applied.add(o.id);
    if (o.filledQty <= 0 || o.avgFillPrice === undefined) return;
    const delta = o.side === "buy" ? o.filledQty : -o.filledQty;
    const ts = o.fills[o.fills.length - 1]?.ts ?? o.submittedAt;
    const h = this.holdings.get(o.symbol);
    const next = (h?.qty ?? 0) + delta;
    if (next === 0) this.holdings.delete(o.symbol);
    else if (!h || Math.sign(next) !== Math.sign(h.qty)) {
      this.holdings.set(o.symbol, { qty: next, entryPrice: o.avgFillPrice, entryTs: ts, barsHeld: 0 });  // opened or flipped
    } else if (Math.abs(next) > Math.abs(h.qty)) {
      h.entryPrice = (h.entryPrice * Math.abs(h.qty) + o.avgFillPrice * Math.abs(delta)) / Math.abs(next); // added
      h.qty = next;
    } else h.qty = next;                                                                                 // reduced
  }

  private violation(message: string): void {
    this.violations.push(message);
    logger.warn(`team3_reversal contract: ${message}`);
  }
}
