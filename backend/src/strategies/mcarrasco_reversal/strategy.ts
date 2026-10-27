import { BaseStrategy } from "../base/strategy";
import { logger } from "../../utils/logger";
import type { EvaluationContext } from "../base/strategy";
import type { BaseStrategyConfig, SignalDirection, StrategySignal, StrategyType } from "../../types/strategy";
import type { MarketEventKind } from "../../types/market";

export interface ReversalConfig extends BaseStrategyConfig {
  type: "mcarrasco_reversal";
  maxPositionQty: number;
}

export class McarrascoReversalStrategy extends BaseStrategy {
  readonly type: StrategyType = "mcarrasco_reversal";
  static readonly VERSION = 4;
  readonly version = McarrascoReversalStrategy.VERSION;
  readonly triggers: readonly MarketEventKind[] = ["bar"];

  private readonly lastBar = new Map<string, { ts: number; close: number }>();

  constructor(readonly myConfig: ReversalConfig) {
    super(myConfig);
  }

  evaluate(context: EvaluationContext): StrategySignal | null {
    if (!this.isActive || !this.myConfig.enabled) return null;
    const { symbol } = context;

    const bar = context.symbolState.get(symbol)?.latestBar;
    if (!bar) return null;

    const prev = this.lastBar.get(symbol);
    if (prev && bar.ts <= prev.ts) return null;
    this.lastBar.set(symbol, { ts: bar.ts, close: bar.close });

    if (!prev || bar.close === prev.close) return null;

    let side: "buy" | "sell";
    if (bar.close > prev.close) {
      side = "sell";
    } else {
      side = "buy";
    }

    const position = context.portfolioState.getPosition(symbol)?.qty ?? 0;
    let after: number;
    if (side === "buy") {
      after = position + 1;
    } else {
      after = position - 1;
    }
    if (Math.abs(after) > this.myConfig.maxPositionQty) return null;

    logger.info(`jcavallin_reversal: ${symbol} ${prev.close} -> ${bar.close}, so ${side} 1 share`);

    if (side === "sell") {
      return this.buildSignal({
        symbol,
        direction: this.directionFor(side, position),
        qty: 1,
        triggerLabel: "bar_up_sell",
      });
    } else {
      return this.buildSignal({
        symbol,
        direction: this.directionFor(side, position),
        qty: 1,
        triggerLabel: "bar_down_buy",
      });
    }
  }

  private directionFor(side: "buy" | "sell", position: number): SignalDirection {
    if (side === "buy") {
      if (position < 0) {
        return "close_short";
      } else {
        return "long";
      }
    } else {
      if (position > 0) {
        return "close_long";
      } else {
        return "short";
      }
    }
  }
}