/**
 * strategies/beginnerReversal/beginnerReversalStrategy.ts
 *
 * The teaching strategy: the smallest thing that still trades for real.
 * When a symbol's latest 1-minute bar closes UP versus the bar before, sell one
 * share; when it closes DOWN, buy one share. Do nothing if it did not move.
 * A position cap stops a long streak of up (or down) bars from piling up.
 *
 * The strategy declares it triggers on bars only, so evaluate() runs once per
 * arriving bar. It still remembers the last bar it handled, so a bar that is
 * delivered twice is never decided on twice.
 *
 * Inputs:  EvaluationContext (latest bar per symbol, current position).
 * Outputs: StrategySignal for qtyPerTrade shares, or null.
 */

import { BaseStrategy } from "../base/strategy";
import { newId } from "../../utils/ids";
import { logger } from "../../utils/logger";
import type { EvaluationContext } from "../base/strategy";
import type { BaseStrategyConfig, SignalDirection, StrategySignal, StrategyType } from "../../types/strategy";
import type { MarketEventKind } from "../../types/market";

export interface BeginnerReversalConfig extends BaseStrategyConfig {
  type: "beginner_reversal";
  /** Whole shares per order. */
  qtyPerTrade: number;
  /** Largest absolute share position per symbol; an order past it is skipped. */
  maxPositionQty: number;
}

export const DEFAULT_BEGINNER_REVERSAL_SYMBOLS = ["SPY", "AAPL"];

export const DEFAULT_BEGINNER_REVERSAL_CONFIG: Omit<BeginnerReversalConfig, "id" | "symbols"> = {
  name: "Beginner Reversal",
  type: "beginner_reversal",
  // The three fields below satisfy the shared config contract; this strategy ignores them.
  rollingWindowMs: 60_000,
  maxPositionSizeUsd: 10_000,
  cooldownMs: 0,
  enabled: true,
  qtyPerTrade: 1,
  maxPositionQty: 1,
};

/** Merges defaults with overrides; a new ID is assigned unless one is given. */
export function createBeginnerReversalConfig(
  overrides: Partial<BeginnerReversalConfig> = {},
): BeginnerReversalConfig {
  return {
    ...DEFAULT_BEGINNER_REVERSAL_CONFIG,
    id: newId(),
    symbols: [...DEFAULT_BEGINNER_REVERSAL_SYMBOLS],
    ...overrides,
  };
}

/** Throws on a config the strategy cannot trade safely, so a bad one fails at start. */
export function validateBeginnerReversalConfig(config: BeginnerReversalConfig): void {
  if (!Array.isArray(config.symbols) || config.symbols.length === 0) {
    throw new Error("beginner_reversal: symbols must be a non-empty list");
  }
  if (config.symbols.some((s) => typeof s !== "string" || s.trim() === "")) {
    throw new Error("beginner_reversal: every symbol must be a non-empty ticker");
  }
  if (!Number.isInteger(config.qtyPerTrade) || config.qtyPerTrade <= 0) {
    throw new Error(`beginner_reversal: qtyPerTrade must be a positive whole number (got ${config.qtyPerTrade})`);
  }
  if (!Number.isInteger(config.maxPositionQty) || config.maxPositionQty < config.qtyPerTrade) {
    throw new Error(
      `beginner_reversal: maxPositionQty must be a whole number >= qtyPerTrade (got ${config.maxPositionQty})`,
    );
  }
}

export class BeginnerReversalStrategy extends BaseStrategy {
  readonly type: StrategyType = "beginner_reversal";
  /** Bump when the signal logic changes (CI enforces it). */
  static readonly VERSION = 2;
  readonly version = BeginnerReversalStrategy.VERSION;
  /** Decide only when a bar arrives; quotes and trades never call evaluate(). */
  readonly triggers: readonly MarketEventKind[] = ["bar"];

  /** The last bar we decided on, per symbol. */
  private readonly lastBar = new Map<string, { ts: number; close: number }>();

  constructor(readonly reversalConfig: BeginnerReversalConfig) {
    super(reversalConfig);
    validateBeginnerReversalConfig(reversalConfig);
  }

  evaluate(context: EvaluationContext): StrategySignal | null {
    if (!this.isActive || !this.reversalConfig.enabled) return null;
    const { symbol } = context;
    if (!this.reversalConfig.symbols.includes(symbol)) return null;

    const bar = context.symbolState.get(symbol)?.latestBar;
    if (!bar) return null;

    // Only a NEW bar is a decision.
    const prev = this.lastBar.get(symbol);
    if (prev && bar.ts <= prev.ts) return null;
    this.lastBar.set(symbol, { ts: bar.ts, close: bar.close });

    // The first bar we see is only a baseline to compare the next one against.
    if (!prev) {
      logger.debug(`beginner_reversal: ${symbol} first bar (close ${bar.close}) is only a baseline, no trade`);
      return null;
    }
    if (bar.close === prev.close) {
      logger.debug(`beginner_reversal: ${symbol} close unchanged at ${bar.close}, no trade`);
      return null;
    }

    const side = bar.close > prev.close ? "sell" : "buy";
    const { qtyPerTrade, maxPositionQty } = this.reversalConfig;
    const position = context.portfolioState.getPosition(symbol)?.qty ?? 0;
    const after = position + (side === "buy" ? qtyPerTrade : -qtyPerTrade);
    if (Math.abs(after) > maxPositionQty) {
      // The most common "why is it not trading?": the position cap is already used up.
      logger.info(
        `beginner_reversal: ${symbol} wanted to ${side} ${qtyPerTrade} but holding ${position} would become ` +
          `${after}, past the cap of ${maxPositionQty}. Skipped. (Raise maxPositionQty to allow more.)`,
      );
      return null;
    }

    logger.info(
      `beginner_reversal: ${symbol} closed ${side === "sell" ? "UP" : "DOWN"} ` +
        `(${prev.close} -> ${bar.close}), so ${side} ${qtyPerTrade} share(s)`,
    );

    return this.buildSignal({
      symbol,
      direction: this.directionFor(side, position),
      qty: qtyPerTrade,
      triggerValue: (bar.close - prev.close) / prev.close,
      triggerLabel: side === "sell" ? "bar_up_sell" : "bar_down_buy",
      meta: { prevClose: prev.close, close: bar.close, positionBefore: position },
    });
  }

  /** Reducing an existing position is a "close", not a new long or short. */
  private directionFor(side: "buy" | "sell", position: number): SignalDirection {
    if (side === "buy") return position < 0 ? "close_short" : "long";
    return position > 0 ? "close_long" : "short";
  }
}
