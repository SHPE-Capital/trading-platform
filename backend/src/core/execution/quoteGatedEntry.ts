/**
 * core/execution/quoteGatedEntry.ts
 *
 * Quote-gated entry order (momentum plan P2-2, spec section 5 "Starting order
 * policy"). An entry is allowed only against a current, uncrossed quote with a
 * tight spread. The buy is a limit at ask * (1 + limit offset), rounded UP to
 * the tick so it stays marketable, and whatever has not filled after the
 * cancel window is cancelled. Any filled quantity, even a partial fill, marks
 * the symbol entered for the session day.
 *
 * Every threshold comes from `QuoteGateConfig` (built from the protocol's
 * `quote_replay.*` keys, see `quoteGateConfigFromProtocol`); nothing is a
 * constant here. The clock, scheduler, id source and session-day function are
 * injected so replay and tests are deterministic.
 *
 * The cancel response is not the truth (docs/guides/alpaca-order-behavior.md,
 * L1): a cancel can race a fill. Fills are therefore taken from order events
 * (`onFill`), and a failed cancel is logged, never thrown.
 *
 * Inputs:  Quote, an IExecutionSink, order fill events (onFill / onClosed).
 * Outputs: A limit-buy OrderIntent submitted through the sink; entered-today state.
 */

import { logger } from "../../utils/logger";
import { newId } from "../../utils/ids";
import type { Quote } from "../../types/market";
import type { Order, OrderIntent } from "../../types/orders";
import type { IExecutionSink } from "./IExecutionSink";

/** Price floor from which a tick size applies, e.g. {minPrice: 1, tick: 0.01}. */
export interface TickRule {
  minPrice: number;
  tick: number;
}

export interface QuoteGateConfig {
  /** A quote older than this is stale (ms). Protocol: quote_replay.max_quote_age_s. */
  maxQuoteAgeMs: number;
  /** Largest allowed (ask - bid) / mid, as a fraction. Protocol: quote_replay.max_spread_pct. */
  maxSpreadFrac: number;
  /** Buy limit = ask * (1 + this), as a fraction. Protocol: quote_replay.limit_offset_pct. */
  limitOffsetFrac: number;
  /** Cancel the unfilled rest after this long (ms). Protocol: quote_replay.cancel_after_s. */
  cancelAfterMs: number;
  /** Tick size by price level; the rule with the highest minPrice <= price applies. */
  tickRules: readonly TickRule[];
}

/** Protocol keys as written in the config reference (seconds and percent). */
export interface QuoteReplayProtocol {
  max_quote_age_s: number;
  max_spread_pct: number;
  limit_offset_pct: number;
  cancel_after_s: number;
}

/** US equity tick sizes under Reg NMS rule 612, supplied as data for `tickRules`. */
export const US_EQUITY_TICK_RULES: readonly TickRule[] = [
  { minPrice: 0, tick: 0.0001 },
  { minPrice: 1, tick: 0.01 },
];

/** Converts the protocol's seconds / percent keys to the gate's ms / fraction units. */
export function quoteGateConfigFromProtocol(p: QuoteReplayProtocol, tickRules: readonly TickRule[]): QuoteGateConfig {
  return {
    maxQuoteAgeMs: p.max_quote_age_s * 1000,
    maxSpreadFrac: p.max_spread_pct / 100,
    limitOffsetFrac: p.limit_offset_pct / 100,
    cancelAfterMs: p.cancel_after_s * 1000,
    tickRules,
  };
}

/** Throws on a config that cannot gate safely. */
export function validateQuoteGateConfig(c: QuoteGateConfig): void {
  const errors: string[] = [];
  if (!(c.maxQuoteAgeMs > 0)) errors.push("maxQuoteAgeMs must be > 0");
  if (!(c.maxSpreadFrac > 0)) errors.push("maxSpreadFrac must be > 0");
  if (!(c.limitOffsetFrac >= 0)) errors.push("limitOffsetFrac must be >= 0");
  if (!(c.cancelAfterMs > 0)) errors.push("cancelAfterMs must be > 0");
  if (c.tickRules.length === 0 || !c.tickRules.some((r) => r.minPrice <= 0)) {
    errors.push("tickRules must include a rule with minPrice <= 0");
  }
  if (c.tickRules.some((r) => !(r.tick > 0))) errors.push("every tick must be > 0");
  if (errors.length > 0) throw new Error(`Invalid quote gate config: ${errors.join("; ")}`);
}

export type QuoteRejectReason =
  | "NO_QUOTE"
  | "INVALID_QUOTE"
  | "CROSSED_QUOTE"
  | "STALE_QUOTE"
  | "WIDE_SPREAD";

export type EntryGateResult =
  | { ok: true; limitPrice: number; spreadFrac: number; quoteAgeMs: number }
  | { ok: false; reason: QuoteRejectReason };

/** Tick size that applies at `price`. */
export function tickFor(price: number, rules: readonly TickRule[]): number {
  let best: TickRule | undefined;
  for (const r of rules) {
    if (r.minPrice <= price && (!best || r.minPrice > best.minPrice)) best = r;
  }
  return (best ?? rules[0]).tick;
}

/**
 * Rounds `price` up to the next allowed tick. Computed in integer units of the
 * tick so float noise (e.g. 10.01 / 0.01) does not push it a tick too high.
 */
export function roundUpToTick(price: number, rules: readonly TickRule[]): number {
  const tick = tickFor(price, rules);
  const decimals = Math.max(0, Math.ceil(-Math.log10(tick)) + 2);
  const units = Math.ceil(Number((price / tick).toFixed(6)));
  return Number((units * tick).toFixed(decimals));
}

/** Decides whether an entry may be sent against `quote` at `nowMs`, and at what limit. */
export function evaluateEntryQuote(
  quote: Quote | undefined | null,
  nowMs: number,
  config: QuoteGateConfig,
): EntryGateResult {
  if (!quote) return { ok: false, reason: "NO_QUOTE" };
  const { bidPrice: bid, askPrice: ask } = quote;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || !Number.isFinite(quote.ts) || bid <= 0 || ask <= 0) {
    return { ok: false, reason: "INVALID_QUOTE" };
  }
  if (bid > ask) return { ok: false, reason: "CROSSED_QUOTE" };
  const quoteAgeMs = nowMs - quote.ts;
  if (quoteAgeMs > config.maxQuoteAgeMs) return { ok: false, reason: "STALE_QUOTE" };
  const spreadFrac = (ask - bid) / ((ask + bid) / 2);
  if (spreadFrac > config.maxSpreadFrac) return { ok: false, reason: "WIDE_SPREAD" };
  const limitPrice = roundUpToTick(ask * (1 + config.limitOffsetFrac), config.tickRules);
  return { ok: true, limitPrice, spreadFrac, quoteAgeMs };
}

export interface QuoteGatedEntryDeps {
  sink: Pick<IExecutionSink, "submitOrder" | "cancelOrder">;
  config: QuoteGateConfig;
  /** Session trading day key (e.g. "2026-11-13") for a timestamp. */
  sessionDay: (ms: number) => string;
  /** Runs `fn` after `delayMs`; returns a function that cancels the timer. */
  schedule: (fn: () => void, delayMs: number) => () => void;
  newId?: () => string;
}

export interface EntryRequest {
  strategyId: string;
  symbol: string;
  qty: number;
  quote: Quote | undefined | null;
  nowMs: number;
  runId?: string;
  signalId?: string;
  reason?: string;
}

export type EntryOutcome =
  | { status: "submitted"; intent: OrderIntent; order: Order }
  | { status: "rejected"; reason: QuoteRejectReason | "ALREADY_ENTERED" | "ENTRY_PENDING" | "INVALID_QTY" | "SUBMIT_FAILED" };

interface Pending {
  symbol: string;
  day: string;
  brokerOrderId?: string;
  filledQty: number;
  cancelTimer?: () => void;
}

export class QuoteGatedEntry {
  private readonly entered = new Set<string>(); // `${day}|${symbol}`
  private readonly pending = new Map<string, Pending>(); // by intent id
  private readonly pendingBySymbol = new Map<string, string>(); // `${day}|${symbol}` -> intent id
  private readonly makeId: () => string;

  constructor(private readonly deps: QuoteGatedEntryDeps) {
    validateQuoteGateConfig(deps.config);
    this.makeId = deps.newId ?? newId;
  }

  /** True if any quantity of `symbol` has filled on the session day of `ms`. */
  enteredToday(symbol: string, ms: number): boolean {
    return this.entered.has(this.key(this.deps.sessionDay(ms), symbol));
  }

  /** Gates and, if allowed, submits the limit buy and arms the cancel timer. */
  async submitEntry(req: EntryRequest): Promise<EntryOutcome> {
    const day = this.deps.sessionDay(req.nowMs);
    const key = this.key(day, req.symbol);
    if (!(req.qty > 0) || !Number.isFinite(req.qty)) return { status: "rejected", reason: "INVALID_QTY" };
    if (this.entered.has(key)) return { status: "rejected", reason: "ALREADY_ENTERED" };
    if (this.pendingBySymbol.has(key)) return { status: "rejected", reason: "ENTRY_PENDING" };

    const gate = evaluateEntryQuote(req.quote, req.nowMs, this.deps.config);
    if (!gate.ok) {
      logger.info("QuoteGatedEntry: entry blocked", { symbol: req.symbol, reason: gate.reason });
      return { status: "rejected", reason: gate.reason };
    }

    const intent: OrderIntent = {
      id: this.makeId(),
      strategyId: req.strategyId,
      symbol: req.symbol,
      side: "buy",
      qty: req.qty,
      orderType: "limit",
      limitPrice: gate.limitPrice,
      timeInForce: "day",
      reason: req.reason,
      ts: req.nowMs,
      runId: req.runId,
      signalId: req.signalId,
      decisionPrice: req.quote ? req.quote.askPrice : undefined,
      meta: { quoteGated: true, spreadFrac: gate.spreadFrac, quoteAgeMs: gate.quoteAgeMs },
    };

    // Reserve before the await so a second call in the same tick is blocked.
    const state: Pending = { symbol: req.symbol, day, filledQty: 0 };
    this.pending.set(intent.id, state);
    this.pendingBySymbol.set(key, intent.id);

    let order: Order;
    try {
      order = await this.deps.sink.submitOrder(intent);
    } catch (err) {
      this.release(intent.id);
      logger.warn("QuoteGatedEntry: submit failed", { symbol: req.symbol, error: String(err) });
      return { status: "rejected", reason: "SUBMIT_FAILED" };
    }
    state.brokerOrderId = order.brokerOrderId;
    // A fill event can arrive while submitOrder resolves; count it from the order too.
    if (order.filledQty > 0) this.recordFill(intent.id, order.filledQty);
    if (this.pending.has(intent.id)) {
      state.cancelTimer = this.deps.schedule(() => void this.cancelRest(intent.id), this.deps.config.cancelAfterMs);
    }
    return { status: "submitted", intent, order };
  }

  /** Feed ORDER_PARTIAL_FILL / ORDER_FILLED: cumulative filled quantity for the intent. */
  onFill(intentId: string, cumulativeFilledQty: number): void {
    this.recordFill(intentId, cumulativeFilledQty);
  }

  /** Feed ORDER_FILLED / ORDER_CANCELED / ORDER_EXPIRED / ORDER_REJECTED: the order is done. */
  onClosed(intentId: string): void {
    this.release(intentId);
  }

  private recordFill(intentId: string, cumulativeFilledQty: number): void {
    const p = this.pending.get(intentId);
    if (!p || !(cumulativeFilledQty > 0)) return;
    p.filledQty = Math.max(p.filledQty, cumulativeFilledQty);
    this.entered.add(this.key(p.day, p.symbol));
  }

  private async cancelRest(intentId: string): Promise<void> {
    const p = this.pending.get(intentId);
    if (!p) return;
    p.cancelTimer = undefined;
    if (!p.brokerOrderId) {
      logger.warn("QuoteGatedEntry: cannot cancel, no broker order id", { symbol: p.symbol });
      return;
    }
    try {
      await this.deps.sink.cancelOrder(p.brokerOrderId);
    } catch (err) {
      // Cancel can lose the race to a fill; the order events are the truth.
      logger.warn("QuoteGatedEntry: cancel failed", { symbol: p.symbol, error: String(err) });
    }
  }

  private release(intentId: string): void {
    const p = this.pending.get(intentId);
    if (!p) return;
    p.cancelTimer?.();
    this.pending.delete(intentId);
    this.pendingBySymbol.delete(this.key(p.day, p.symbol));
  }

  private key(day: string, symbol: string): string {
    return `${day}|${symbol}`;
  }
}
