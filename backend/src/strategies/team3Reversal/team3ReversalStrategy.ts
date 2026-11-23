/**
 * strategies/team3Reversal/team3ReversalStrategy.ts
 *
 * Team 3 Reversal, VERSION 6: intraday VWAP reversion on 1-minute bars (V5 added useCostGate; V6 adds Rivera's relativeToSpy rule (still a stub) and the Stage 2 per-goal config blocks; all off by default).
 *
 *   Enter  fade a session bar that leaves price >= entryZ sigmas from VWAP,
 *          when the way back to VWAP beats costs (minEdgeBps). One position per symbol.
 *   Exit   first of: stale (earlier day) / close (end of day) / stop (stopZ) /
 *          target (back to VWAP) / time (maxHoldBars).
 *   Size   fixed dollars per trade (or vol sizing), capped per symbol and in gross.
 *   Filters (switches) can block an entry; with every switch off this is the baseline.
 *
 * Data flow, one call per (minute, symbol):
 *   platform -> contract/frame -> history (session only) -> rules -> risk -> contract/emit -> platform
 *                                         contract/book (own fills) ----^
 *
 * Inputs:  EvaluationContext. Outputs: StrategySignal or null.
 * Contract with the platform: CONTRACT.md. Docs: docs/team3/components/baseline.md
 * Owner: team lead. Teammates change only their own file in filters/.
 */

import { BaseStrategy } from "../base/strategy";
import { logger } from "../../utils/logger";
import type { EvaluationContext } from "../base/strategy";
import type { StrategySignal, StrategyType } from "../../types/strategy";
import type { MarketEventKind } from "../../types/market";
import { validateTeam3ReversalConfig, type Team3ReversalConfig } from "./team3ReversalConfig";
import { TEAM3_FILTERS, enabledEntryFilters, firstBlocking, type FilterSet } from "./filters";
import type { BarView, VwapView } from "./filters/types";
import { readFrame, type MinuteFrame } from "./contract/frame";
import { Team3Book, type Holding } from "./contract/book";
import { toSignal, signedQty, type Decision } from "./contract/emit";
import { SessionHistory } from "./history";
import { costGate, entryIdea, exitReason, sessionWindow, type EntryIdea } from "./rules";
import { capQty, grossUsd } from "./risk";
import { fixedNotionalQty, volTargetQty } from "./sizing";

export class Team3ReversalStrategy extends BaseStrategy {
  readonly type: StrategyType = "team3_reversal";
  /** Bump whenever this folder's trading logic changes, filters included (CI enforces it). */
  static readonly VERSION = 6;
  readonly version = Team3ReversalStrategy.VERSION;
  /** Decide only when a bar arrives; quotes and trades never call evaluate(). */
  readonly triggers: readonly MarketEventKind[] = ["bar"];

  /** Team 3's own positions and entry fills (not the account's). Read by contract tests. */
  readonly book: Team3Book;
  private readonly history = new SessionHistory();
  /** Last bar timestamp we decided on, per symbol: each bar is decided once. */
  private readonly decided = new Map<string, number>();
  private readonly filters: FilterSet;

  /**
   * @param teamConfig - full config (use createTeam3ReversalConfig())
   * @param filters    - tests can swap in their own filters; trading always uses TEAM3_FILTERS
   */
  constructor(readonly teamConfig: Team3ReversalConfig, filters: FilterSet = TEAM3_FILTERS) {
    super(teamConfig);
    validateTeam3ReversalConfig(teamConfig, filters);
    this.filters = filters;
    this.book = new Team3Book(teamConfig.id);
  }

  evaluate(ctx: EvaluationContext): StrategySignal | null {
    const c = this.teamConfig;
    if (!this.isActive || !c.enabled || !c.symbols.includes(ctx.symbol)) return null;

    // 1. READ: this bar, every symbol's latest bar, and our own fills since last time
    const frame = readFrame(ctx, c.symbols);
    if (!frame) return null;
    const { symbol, bar } = frame;
    this.book.reconcile(symbol, ctx.orderState);

    // 2. RECORD: session-only history + VWAP for all symbols (pre/post-market never enters)
    for (const [s, b] of frame.latest) this.history.ingest(s, b);

    // 3. GUARD: decide once per session bar, never with an order still working
    if (!this.isNewSessionBar(symbol, bar) || this.book.hasPending(symbol)) return null;
    const today = this.history.today(symbol);
    const vwap = this.history.vwap(symbol, c.vwapWindowBars);
    const window = sessionWindow(bar.ts, c);

    // 4. EXIT: holding? the first exit reason closes all of it
    const holding = this.book.tick(symbol);
    if (holding) return this.exit(frame, holding, window, vwap);

    // 5. ENTER: flat, in the trading window, stretched from VWAP with edge > costs, filters agree
    const prev = today[today.length - 2];
    if (!prev || window !== "open") return null;
    const idea = entryIdea(bar, prev, vwap, c);
    if (!idea) return null;
    if (c.useCostGate && !costGate(idea.edgeBps, bar.close, c)) return this.skip(`${symbol} ${idea.side}: edge ${idea.edgeBps.toFixed(1)} bps fails the cost gate`);
    const earlier = today.slice(-(c.lookbackBars + 1), -1);
    const active = enabledEntryFilters(this.filters, c);
    const blockedBy = firstBlocking(active, {
      symbol, bar, history: earlier, move: idea.move, side: idea.side, vwap, config: c,
      barsOf: (s) => this.history.today(s),
    });
    if (blockedBy) return this.skip(`${symbol} ${idea.side} blocked by ${blockedBy}`);

    // 6. SIZE: fixed dollars (or vol), capped per symbol and in gross, shorts included
    const want = c.useVolSizing ? volTargetQty(earlier, bar, c.riskPerTradeUsd) : fixedNotionalQty(c.tradeUsd, bar.close);
    const gross = grossUsd(this.book.exposures(), frame.priceOf);
    const qty = capQty({ want, price: bar.close, symbolUsd: 0, grossUsd: gross }, { maxSymbolUsd: c.maxPositionSizeUsd, maxGrossUsd: c.maxGrossUsd });
    if (qty <= 0) return this.skip(`${symbol} ${idea.side}: no room (wanted ${want}, gross $${gross.toFixed(0)})`);

    // 7. EMIT: the signal, plus the numbers behind it
    return this.send(bar, {
      kind: "enter", symbol, side: idea.side, qty, trigger: idea.z,
      meta: { ...this.entryMeta(prev, bar, idea, vwap), filtersOn: active.map((f) => f.name).join(",") || "none",
        sizing: c.useVolSizing ? "vol" : "fixed", qtyWanted: want, grossUsdBefore: gross },
    });
  }

  /** 4. EXIT detail: ask the rules, and close exactly the shares Team 3 holds. */
  private exit(frame: MinuteFrame, h: Holding, window: ReturnType<typeof sessionWindow>, vwap: VwapView | null): StrategySignal | null {
    const { symbol, bar } = frame;
    const view = { qty: h.qty, barsHeld: h.barsHeld, fromEarlierDay: this.book.isFromEarlierDay(h, bar.ts) };
    const reason = exitReason(view, window, vwap?.z ?? null, this.teamConfig);
    if (!reason) return null;
    // Gross: this close vs the real entry fill. Excludes the exit's own costs (fill happens next bar).
    const pnlBpsGross = (Math.sign(h.qty) * (bar.close - h.entryPrice) / h.entryPrice) * 10_000;
    return this.send(bar, {
      kind: "exit", symbol, heldQty: h.qty, reason, trigger: pnlBpsGross,
      meta: { entryPrice: h.entryPrice, close: bar.close, barsHeld: h.barsHeld, pnlBpsGross, vwap: vwap?.vwap ?? null, vwapZ: vwap?.z ?? null },
    });
  }

  /** 7. EMIT detail: remember the order as pending, then hand the platform its signal. */
  private send(bar: BarView, d: Decision): StrategySignal {
    this.book.markPending(d.symbol, bar.ts, signedQty(d), bar.close);
    return this.buildSignal(toSignal(d));
  }

  private entryMeta(prev: BarView, bar: BarView, idea: EntryIdea, vwap: VwapView | null): Record<string, unknown> {
    return {
      prevClose: prev.close, close: bar.close, move: idea.move, vwap: vwap?.vwap ?? null, vwapSigma: vwap?.sigma ?? null,
      vwapZ: idea.z, edgeBps: idea.edgeBps, vwapCrossings: vwap?.crossings ?? null, sessionBars: vwap?.sessionBars ?? null,
    };
  }

  /** True once per regular-session bar per symbol. */
  private isNewSessionBar(symbol: string, bar: BarView): boolean {
    const today = this.history.today(symbol);
    if (today[today.length - 1]?.ts !== bar.ts || (this.decided.get(symbol) ?? -Infinity) >= bar.ts) return false;
    this.decided.set(symbol, bar.ts);
    return true;
  }

  private skip(message: string): null {
    logger.debug(`team3_reversal: ${message}. Skipped.`);
    return null;
  }
}
