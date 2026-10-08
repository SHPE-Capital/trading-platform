/**
 * strategies/minuteReversal/minuteReversalStrategy.ts
 *
 * Minute-bar reversal: a deliberately simple test strategy that exercises the
 * live order path across many symbols at once. On each new 1-minute bar of the
 * regular session it sells a symbol whose close rose versus its previous bar
 * and buys one whose close fell. An unchanged close does nothing.
 *
 * The orchestrator evaluates strategies on every quote, trade, and bar, so the
 * strategy acts only when a symbol's latest bar is newer than the last one it
 * handled — exactly one decision per bar per symbol.
 *
 * Inputs:  EvaluationContext (latest bar per symbol, book position).
 * Outputs: StrategySignal for qtyPerTrade shares, or null.
 */

import { BaseStrategy } from "../base/strategy";
import { nowMs } from "../../utils/time";
import { validateMinuteReversalConfig } from "./minuteReversalConfig";
import type { EvaluationContext } from "../base/strategy";
import type { SignalDirection, StrategySignal, StrategyType } from "../../types/strategy";
import type { Bar } from "../../types/market";
import type {
  MinuteReversalConfig,
  MinuteReversalSignalMeta,
  MinuteReversalSymbolState,
} from "./minuteReversalTypes";

/** A minute bar is complete once its minute has passed. */
const BAR_DURATION_MS = 60_000;

const NEW_YORK_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const SESSION_OPEN_MINUTE = 9 * 60 + 30;
const SESSION_CLOSE_MINUTE = 16 * 60;

/**
 * True for a bar that opens in the regular session and closes before the bell.
 * The decision is made when the bar arrives, a minute after it opens, so the
 * 15:59 bar would be decided after the close.
 */
function inRegularSession(barTs: number): boolean {
  const parts = Object.fromEntries(NEW_YORK_CLOCK.formatToParts(barTs).map((p) => [p.type, p.value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return minute >= SESSION_OPEN_MINUTE && minute + 1 < SESSION_CLOSE_MINUTE;
}

export class MinuteReversalStrategy extends BaseStrategy {
  readonly type: StrategyType = "minute_reversal";
  // v2: trades only regular-session bars; extended-hours bars are baselines
  static readonly VERSION = 2;
  readonly version = MinuteReversalStrategy.VERSION;

  private readonly bars = new Map<string, MinuteReversalSymbolState>();

  /**
   * @param reversalConfig - Full MinuteReversalConfig (use createMinuteReversalConfig())
   */
  constructor(readonly reversalConfig: MinuteReversalConfig) {
    super(reversalConfig as never);
    validateMinuteReversalConfig(reversalConfig);
    for (const symbol of reversalConfig.symbols) {
      this.bars.set(symbol, { lastBarTs: null, lastClose: null });
    }
  }

  evaluate(context: EvaluationContext): StrategySignal | null {
    if (!this.isActive || !this.reversalConfig.enabled) return null;
    const { symbol } = context;
    const memory = this.bars.get(symbol);
    const bar = context.symbolState.get(symbol)?.latestBar;
    if (!memory || !bar) return null;

    // Quotes and trades re-evaluate between bars; only a new bar is a decision.
    if (memory.lastBarTs !== null && bar.ts <= memory.lastBarTs) return null;

    const prevTs = memory.lastBarTs;
    const prevClose = memory.lastClose;
    memory.lastBarTs = bar.ts;
    memory.lastClose = bar.close;

    if (prevTs === null || prevClose === null) return null;
    if (bar.ts - prevTs > this.reversalConfig.maxBarGapMs) return null;
    if (this.reversalConfig.regularHoursOnly && !inRegularSession(bar.ts)) return null;
    if (bar.close === prevClose) return null;

    const side = bar.close > prevClose ? "sell" : "buy";
    const { qtyPerTrade, maxPositionQty } = this.reversalConfig;
    const position = context.portfolioState.getPosition(symbol)?.qty ?? 0;
    const after = position + (side === "buy" ? qtyPerTrade : -qtyPerTrade);
    if (Math.abs(after) > maxPositionQty) return null;

    const meta: MinuteReversalSignalMeta = {
      prevBarTs: new Date(prevTs).toISOString(),
      prevClose,
      barTs: bar.isoTs ?? new Date(bar.ts).toISOString(),
      close: bar.close,
      positionBefore: position,
    };

    return this.buildSignal({
      symbol,
      direction: this._direction(side, position),
      qty: qtyPerTrade,
      triggerValue: (bar.close - prevClose) / prevClose,
      triggerLabel: side === "sell" ? "minute_up_sell" : "minute_down_buy",
      meta,
    });
  }

  /** Enough history to find each symbol's latest complete bar. */
  warmUpLookbackMs(): number {
    return this.reversalConfig.maxBarGapMs;
  }

  /**
   * Remembers each symbol's latest complete bar so the first live bar can
   * already be compared. Never emits signals. An in-progress bar is skipped:
   * the live stream delivers its final version, which would otherwise be
   * mistaken for an already-handled bar.
   */
  warmUp(bars: Bar[]): number {
    const completeBefore = nowMs() - BAR_DURATION_MS;
    let primed = 0;
    for (const bar of bars) {
      const memory = this.bars.get(bar.symbol);
      if (!memory || bar.ts > completeBefore) continue;
      if (memory.lastBarTs !== null && bar.ts <= memory.lastBarTs) continue;
      memory.lastBarTs = bar.ts;
      memory.lastClose = bar.close;
      primed++;
    }
    return primed;
  }

  /** Closing directions keep the signal honest about reducing an existing position. */
  private _direction(side: "buy" | "sell", position: number): SignalDirection {
    if (side === "buy") return position < 0 ? "close_short" : "long";
    return position > 0 ? "close_long" : "short";
  }
}
