/**
 * strategies/imbalanceForecast/imbalanceForecastStrategy.ts
 *
 * TEAM 3 — TEACHING STRATEGY: Order Book Imbalance
 * ==================================================================
 *
 * THE IDEA IN ONE SENTENCE
 *   When many more shares wait to buy than to sell, the price tends to
 *   tick up soon (and the reverse). So: buy when buyers outweigh sellers,
 *   sell when sellers outweigh buyers, and get out after a short time.
 *
 * WHAT THIS FILE TEACHES
 *   How to plug a strategy into the SHPE trading platform by extending
 *   the contract in strategies/base/strategy.ts. There is no machine
 *   learning here: just two features and a simple rule.
 *
 * THE CONTRACT (four things every strategy does)
 *   1. EXTEND BaseStrategy. You get for free:
 *        this.id          a unique ID from the config
 *        this.isActive    true after start(), false after stop()
 *        buildSignal()    fills in the boring signal fields for you
 *
 *   2. DECLARE who you are:
 *        type       a name from StrategyType (types/strategy.ts)
 *        version    bump it whenever your trading logic changes
 *        triggers   which market events wake you up ("quote" here)
 *
 *   3. IMPLEMENT evaluate(context). The platform calls it on every new
 *      quote for your symbols. You answer one of two things:
 *        null             → "do nothing" (most of the time)
 *        a StrategySignal → "I want to trade this"
 *
 *   4. FOLLOW THE RULES:
 *        - Be fast. No waiting, no internet calls, no database writes.
 *        - Only use data you have right now. Never peek at the future.
 *        - You never place orders. You send a signal; the RiskEngine
 *          checks it, then the platform places the order.
 *
 * WHERE THINGS HAPPEN
 *   core/engine/orchestrator.ts   calls evaluate() (search "_evaluateStrategies")
 *   core/state/symbolState.ts     holds the latest quote we read
 *   core/risk/                    checks our signals before any order
 */

import { BaseStrategy } from "../base/strategy";
import type { EvaluationContext } from "../base/strategy";
import type { BaseStrategyConfig, StrategySignal, StrategyType } from "../../types/strategy";
import type { Quote } from "../../types/market";

// ==================================================================
// SETTINGS — the knobs. Change these, not the logic, when experimenting.
// ==================================================================

export const SETTINGS = {
  /** Buy when imbalance is above this, sell when below its negative. Range 0 to 1. */
  imbalanceThreshold: 0.6,
  /** Only trade when the spread is this many cents (ticks) or less. */
  maxSpreadTicks: 1,
  /** Smallest price step for US stocks: one cent. */
  tickSize: 0.01,
  /** Shares per trade. */
  qtyPerTrade: 1,
  /** Never hold more than this many shares, long or short. */
  maxPositionQty: 5,
  /** Close any position after this long (60 seconds). */
  maxHoldMs: 60_000,
  /** Decide at most once per second, even if quotes arrive faster. */
  decisionIntervalMs: 1_000,
};

// ==================================================================
// FEATURES — small, pure functions: quote in, number out.
// Exported so tests (and the Python notebook) can check them by hand.
// ==================================================================

/**
 * Imbalance: which side of the book is heavier?
 *   +1 = only buyers waiting, −1 = only sellers waiting, 0 = balanced.
 *
 *   imbalance = (bidSize − askSize) / (bidSize + askSize)
 *
 * Example: bidSize 8, askSize 2 → (8 − 2) / (8 + 2) = 0.6
 */
export function imbalance(quote: Quote): number {
  return (quote.bidSize - quote.askSize) / (quote.bidSize + quote.askSize);
}

/**
 * Spread in ticks: how many cents between the best buyer and best seller?
 * A wide spread means trading is expensive, so we sit it out.
 *
 *   spreadTicks = (ask − bid) / tickSize
 *
 * Example: bid 580.00, ask 580.01 → 0.01 / 0.01 = 1 tick
 */
export function spreadTicks(quote: Quote, tickSize = SETTINGS.tickSize): number {
  // Rounded because 580.01 − 580.00 is 0.00999999... in floating point
  return Math.round((quote.askPrice - quote.bidPrice) / tickSize);
}

/** Basic sanity: positive prices, bid below ask, sizes above zero. */
export function isUsableQuote(quote: Quote): boolean {
  return (
    quote.bidPrice > 0 &&
    quote.askPrice > quote.bidPrice &&
    quote.bidSize > 0 &&
    quote.askSize > 0
  );
}

// ==================================================================
// THE STRATEGY
// ==================================================================

export class ImbalanceForecastStrategy extends BaseStrategy {
  // ---------------- Contract step 2: who we are ----------------
  static readonly VERSION = 1;
  readonly version = ImbalanceForecastStrategy.VERSION;
  readonly type: StrategyType = "market_making";   //left to use via contract

  // ---------------- Our own memory between calls ----------------
  /** When we last made a decision, per symbol (quote time, ms) */
  private lastDecisionTs = new Map<string, number>();
  /** When we opened the current position, per symbol */
  private openedAt = new Map<string, number>();

  constructor(config: BaseStrategyConfig, readonly settings = SETTINGS) { //left to use for config
    super(config);
  }

  // ---------------- Contract step 3: the decision ----------------
  evaluate(context: EvaluationContext): StrategySignal | null {  //left to us for actual evaluation strategy
    const { symbol } = context;
    const s = this.settings;

    // STEP 1 — Are we on, and do we have a usable quote?
    if (!this.isActive) return null;
    const quote = context.symbolState.get(symbol)?.latestQuote;
    if (!quote || !isUsableQuote(quote)) return null;

    // STEP 2 — Decide at most once per second.
    // We use the quote's own time (not the clock) so tests and backtests
    // behave exactly like live trading.
    const last = this.lastDecisionTs.get(symbol);
    if (last !== undefined && quote.ts - last < s.decisionIntervalMs) return null;
    this.lastDecisionTs.set(symbol, quote.ts);

    // STEP 3 — Where do we stand? (+ long, − short, 0 flat)
    const position = context.portfolioState.getPosition(symbol)?.qty ?? 0;
    if (position === 0) this.openedAt.delete(symbol);
    else if (!this.openedAt.has(symbol)) this.openedAt.set(symbol, quote.ts);

    // STEP 4 — Time exit: held too long? Close, whatever the book says.
    const opened = this.openedAt.get(symbol);
    if (position !== 0 && opened !== undefined && quote.ts - opened >= s.maxHoldMs) {
      return this.buildSignal({
        symbol,
        direction: position > 0 ? "close_long" : "close_short",
        qty: Math.abs(position),
        triggerLabel: "time_exit",
      });
    }

    // STEP 5 — Features
    const imb = imbalance(quote);
    const spread = spreadTicks(quote, s.tickSize);

    // STEP 6 — Filter: spread too wide means trading costs too much.
    if (spread > s.maxSpreadTicks) return null;

    // STEP 7 — The rule
    const meta = { imbalance: imb, spreadTicks: spread, bid: quote.bidPrice, ask: quote.askPrice };

    if (imb >= s.imbalanceThreshold && position < s.maxPositionQty) {
      // Buyers are heavier → expect a tick up → go long (close a short first)
      return this.buildSignal({
        symbol,
        direction: position < 0 ? "close_short" : "long",
        qty: position < 0 ? Math.abs(position) : s.qtyPerTrade,
        triggerValue: imb,
        triggerLabel: "bid_heavy",
        meta,
      });
    }

    if (imb <= -s.imbalanceThreshold && position > -s.maxPositionQty) {
      // Sellers are heavier → expect a tick down → go short (close a long first)
      return this.buildSignal({
        symbol,
        direction: position > 0 ? "close_long" : "short",
        qty: position > 0 ? position : s.qtyPerTrade,
        triggerValue: imb,
        triggerLabel: "ask_heavy",
        meta,
      });
    }

    // STEP 8 — Nothing strong enough. Do nothing.
    return null;
  }
}

// ==================================================================
// EXERCISES (pick one, add a test for it in
// tests/strategy/imbalanceForecastStrategy.test.ts)
// ==================================================================
//
//  1. Add a third feature: microprice offset in ticks.
//       micro = (askSize·bid + bidSize·ask) / (bidSize + askSize)
//       microOffsetTicks = (micro − mid) / tickSize
//     Hint: quote.microPrice and quote.midPrice already exist. Check your
//     answer against imbalance × spreadTicks / 2.
//
//  2. Add a recent-return feature: how much did the mid move in the last
//     10 seconds? You will need to remember past mids (a Map of arrays,
//     or core/state/rollingWindow.ts).
//
//  3. Only enter if imbalance has stayed above the threshold for two
//     decisions in a row. Does that reduce the number of trades?
//
//
//  Remember: any change to trading logic → bump VERSION.
