/**
 * strategies/team3Reversal/team3ReversalStrategy.ts
 *
 * Team 3's reversal strategy. The baseline is Beginner Reversal: when a
 * regular-session 1-minute bar closes UP versus the bar before, sell; when it
 * closes DOWN, buy. Each filter in filters/ is an on/off switch on top of it:
 *
 *   - Entry filters (bigMove, volume, relativeToSpy, timeOfDay) can block a
 *     trade the baseline wants. They run in order; the first "no" wins.
 *   - The exit rule (holdUntilBack) changes how positions close: with it on,
 *     the strategy enters once, ignores new signals while holding, and closes
 *     the whole position when the rule says so.
 *
 * With every switch off it trades exactly like Beginner Reversal.
 *
 * Inputs:  EvaluationContext (latest bar per symbol, current position).
 * Outputs: StrategySignal or null.
 *
 * Owner: team lead. Teammates change only their own file in filters/.
 */

import { BaseStrategy } from "../base/strategy";
import { logger } from "../../utils/logger";
import type { EvaluationContext } from "../base/strategy";
import type { SignalDirection, StrategySignal, StrategyType } from "../../types/strategy";
import type { MarketEventKind } from "../../types/market";
import { validateTeam3ReversalConfig, type Team3ReversalConfig } from "./team3ReversalConfig";
import { inRegularSession } from "./session";
import { TEAM3_FILTERS, enabledEntryFilters, type FilterSet } from "./filters";
import type { BarView } from "./filters/types";

interface OpenPosition {
  entryPrice: number;
  barsHeld: number;
}

export class Team3ReversalStrategy extends BaseStrategy {
  readonly type: StrategyType = "team3_reversal";
  /** Bump whenever this folder's trading logic changes, filters included (CI enforces it). */
  static readonly VERSION = 1;
  readonly version = Team3ReversalStrategy.VERSION;
  /** Decide only when a bar arrives; quotes and trades never call evaluate(). */
  readonly triggers: readonly MarketEventKind[] = ["bar"];

  /** Recent bars per symbol, oldest first, capped at lookbackBars + 1. */
  private readonly bars = new Map<string, BarView[]>();
  /** Entry details per symbol while holdUntilBack holds a position. */
  private readonly open = new Map<string, OpenPosition>();
  private readonly filters: FilterSet;

  /**
   * @param teamConfig - full config (use createTeam3ReversalConfig())
   * @param filters    - tests can swap in their own filters; trading always uses TEAM3_FILTERS
   */
  constructor(readonly teamConfig: Team3ReversalConfig, filters: FilterSet = TEAM3_FILTERS) {
    super(teamConfig);
    validateTeam3ReversalConfig(teamConfig);
    this.filters = filters;
  }

  evaluate(context: EvaluationContext): StrategySignal | null {
    if (!this.isActive || !this.teamConfig.enabled) return null;
    const { symbol } = context;
    if (!this.teamConfig.symbols.includes(symbol)) return null;

    const latest = context.symbolState.get(symbol)?.latestBar;
    if (!latest) return null;

    // 1. Only a NEW bar is a decision. Keep it in this symbol's history either way.
    const history = this.bars.get(symbol) ?? [];
    const prev = history[history.length - 1];
    if (prev && latest.ts <= prev.ts) return null;
    const bar: BarView = {
      ts: latest.ts, open: latest.open, high: latest.high, low: latest.low, close: latest.close, volume: latest.volume,
    };
    const earlier = history.slice(-this.teamConfig.lookbackBars);
    this.remember(symbol, history, bar);

    // 2. The first bar is only a baseline to compare the next one against.
    if (!prev) return null;
    // 3. Outside 9:30-16:00 ET the bar only updates history.
    if (this.teamConfig.regularHoursOnly && !inRegularSession(bar.ts)) return null;

    const position = context.portfolioState.getPosition(symbol)?.qty ?? 0;
    const barsOf = (s: string): readonly BarView[] => this.bars.get(s) ?? [];

    // 4. holdUntilBack: while a position is open, only the exit rule decides.
    if (this.teamConfig.useHoldUntilBack) {
      if (position !== 0) return this.maybeExit(symbol, bar, earlier, position, prev.close, barsOf);
      this.open.delete(symbol);
    }

    // 5. The baseline's idea: fade the bar.
    if (bar.close === prev.close) return null;
    const move = (bar.close - prev.close) / prev.close;
    const side = move > 0 ? "sell" : "buy";

    // 6. Entry filters that are switched on, in order; the first "no" blocks the trade.
    const active = enabledEntryFilters(this.filters, this.teamConfig);
    for (const filter of active) {
      if (!filter.allows({ symbol, bar, history: earlier, move, side, barsOf, config: this.teamConfig })) {
        logger.debug(`team3_reversal: ${symbol} ${side} blocked by ${filter.name}`);
        return null;
      }
    }

    // 7. Position cap, same as the baseline.
    const { qtyPerTrade, maxPositionQty } = this.teamConfig;
    const after = position + (side === "buy" ? qtyPerTrade : -qtyPerTrade);
    if (Math.abs(after) > maxPositionQty) {
      logger.info(
        `team3_reversal: ${symbol} wanted to ${side} ${qtyPerTrade} but holding ${position} would become ` +
          `${after}, past the cap of ${maxPositionQty}. Skipped.`,
      );
      return null;
    }

    if (this.teamConfig.useHoldUntilBack) this.open.set(symbol, { entryPrice: bar.close, barsHeld: 0 });
    return this.buildSignal({
      symbol,
      direction: this.directionFor(side, position),
      qty: qtyPerTrade,
      triggerValue: move,
      triggerLabel: side === "sell" ? "bar_up_sell" : "bar_down_buy",
      meta: {
        prevClose: prev.close, close: bar.close, positionBefore: position,
        filtersOn: active.map((f) => f.name).join(",") || "none",
      },
    });
  }

  /** holdUntilBack: count the bar, ask the exit rule, and close everything if it says so. */
  private maybeExit(
    symbol: string, bar: BarView, earlier: BarView[], position: number, prevClose: number,
    barsOf: (s: string) => readonly BarView[],
  ): StrategySignal | null {
    // A position we did not open (e.g. after a restart) is treated as entered on the previous bar.
    const held = this.open.get(symbol) ?? { entryPrice: prevClose, barsHeld: 0 };
    held.barsHeld += 1;
    this.open.set(symbol, held);

    const exit = this.filters.exit({
      symbol, bar, history: earlier, positionQty: position, entryPrice: held.entryPrice,
      barsHeld: held.barsHeld, barsOf, config: this.teamConfig,
    });
    if (!exit) return null;

    this.open.delete(symbol);
    return this.buildSignal({
      symbol,
      direction: position > 0 ? "close_long" : "close_short",
      qty: Math.abs(position),
      triggerValue: (bar.close - held.entryPrice) / held.entryPrice,
      triggerLabel: "hold_until_back_exit",
      meta: { entryPrice: held.entryPrice, close: bar.close, barsHeld: held.barsHeld, positionBefore: position },
    });
  }

  /** Adds a bar to the symbol's history and drops the oldest past lookbackBars + 1. */
  private remember(symbol: string, history: BarView[], bar: BarView): void {
    history.push(bar);
    const keep = this.teamConfig.lookbackBars + 1;
    if (history.length > keep) history.splice(0, history.length - keep);
    this.bars.set(symbol, history);
  }

  /** Reducing an existing position is a "close", not a new long or short. */
  private directionFor(side: "buy" | "sell", position: number): SignalDirection {
    if (side === "buy") return position < 0 ? "close_short" : "long";
    return position > 0 ? "close_long" : "short";
  }
}
