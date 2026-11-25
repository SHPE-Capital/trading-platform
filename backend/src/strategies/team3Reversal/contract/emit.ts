/**
 * strategies/team3Reversal/contract/emit.ts
 *
 * WRITE side of the contract: a Team 3 decision becomes a platform StrategySignal.
 * Promises (CONTRACT.md, "We promise back"):
 *   - direction is long / short for a new entry, close_long / close_short for an exit;
 *   - qty is a whole number > 0, and an exit closes exactly the shares Team 3 holds;
 *   - meta carries the numbers behind the decision (for the demo and the paper).
 *
 * Owner: team lead.
 */

import type { StrategySignal } from "../../../types/strategy";
import type { ExitReason, Side } from "../rules";

export type Decision =
  | { kind: "enter"; symbol: string; side: Side; qty: number; trigger: number; meta: Record<string, unknown> }
  | { kind: "exit"; symbol: string; heldQty: number; reason: ExitReason; trigger: number; meta: Record<string, unknown> };

/** The signal body BaseStrategy.buildSignal() fills in (it adds id, strategy and time). */
export type SignalBody = Omit<StrategySignal, "id" | "strategyId" | "strategyType" | "ts">;

export function toSignal(d: Decision): SignalBody {
  const qty = d.kind === "enter" ? d.qty : Math.abs(d.heldQty);
  if (!Number.isInteger(qty) || qty <= 0) throw new Error(`team3_reversal: refusing to emit qty ${qty} for ${d.symbol}`);
  if (d.kind === "enter") {
    return {
      symbol: d.symbol, qty, triggerValue: d.trigger,
      direction: d.side === "buy" ? "long" : "short",
      triggerLabel: d.side === "buy" ? "vwap_fade_buy" : "vwap_fade_sell",
      meta: { kind: "enter", ...d.meta },
    };
  }
  return {
    symbol: d.symbol, qty, triggerValue: d.trigger,
    direction: d.heldQty > 0 ? "close_long" : "close_short",
    triggerLabel: `exit_${d.reason}`,
    meta: { kind: "exit", reason: d.reason, ...d.meta },
  };
}

/** Signed share change a decision asks for (buy +, sell -). */
export function signedQty(d: Decision): number {
  return d.kind === "enter" ? (d.side === "buy" ? d.qty : -d.qty) : -d.heldQty;
}
