/**
 * core/replay/attributionCollector.ts
 *
 * Accumulates per-signal and portfolio metrics while a session plays back.
 * Subscribes to the EventBus and correlates STRATEGY_SIGNAL_CREATED →
 * ORDER_SUBMITTED → ORDER_FILLED / RISK_REJECTED / CAPITAL_UNAVAILABLE by the
 * signal ID that orders, intents and rejections carry, to build a
 * ReplayAttribution report.
 *
 * The replay runtime does not re-run strategies, so the report describes the
 * signals and fills that were recorded. Realized P&L is gross of commission:
 * fills are matched FIFO per strategy and symbol, and a closed lot's P&L and
 * holding time go to the signal that opened it.
 *
 * Inputs:  EventBus events published during replay; optional SymbolStateManager
 *          for mid-price capture at signal time.
 * Outputs: ReplayAttribution via getAttribution()
 */

import type { EventBus } from "../engine/eventBus";
import type { SymbolStateManager } from "../state/symbolState";
import type { TradingEvent } from "../../types/events";
import type { Fill } from "../../types/orders";
import type {
  ReplayAttribution,
  SignalAttribution,
  StrategyAttributionSummary,
} from "../../types/replay";
import type { EpochMs, UUID } from "../../types/common";

interface OrderLink {
  signalId?: UUID;
  strategyId: string;
}

/** An open slice of a position: signed qty (long > 0), its entry, and who opened it. */
interface Lot {
  qty: number;
  price: number;
  ts: EpochMs;
  signalId?: UUID;
}

/** Fill VWAP accumulator for a signal's own symbol. */
interface FillAcc {
  qty: number;
  notional: number;
}

export class AttributionCollector {
  private sessionId: UUID | null = null;
  private signals = new Map<UUID, SignalAttribution>();
  private fillAcc = new Map<UUID, FillAcc>();
  private orders = new Map<UUID, OrderLink>();
  private lots = new Map<string, Lot[]>();
  private lastMid = new Map<string, number>();
  private equityCurve: Array<{ ts: EpochMs; equity: number }> = [];

  private readonly handler = (event: TradingEvent): void => this._onEvent(event);

  constructor(
    private readonly eventBus: EventBus,
    /** Provides mid price lookup at the moment a signal fires.
     *  Only available when an Orchestrator is running alongside the ReplayEngine;
     *  otherwise the collector tracks mids from the replayed market data. */
    private readonly symbolState?: SymbolStateManager,
  ) {}

  /**
   * Begins collection for the given session, discarding any earlier session's
   * data. Subscribes to all EventBus events.
   * @param sessionId - ID of the active ReplaySession
   */
  start(sessionId: UUID): void {
    this.stop();
    this.sessionId = sessionId;
    this.signals = new Map();
    this.fillAcc = new Map();
    this.orders = new Map();
    this.lots = new Map();
    this.lastMid = new Map();
    this.equityCurve = [];
    this.eventBus.onAll(this.handler);
  }

  /**
   * Stops collection and unsubscribes from the EventBus. Collected data stays
   * readable through getAttribution().
   */
  stop(): void {
    this.eventBus.offAll(this.handler);
  }

  /** ID of the session being (or last) collected, or null before start(). */
  get activeSessionId(): UUID | null {
    return this.sessionId;
  }

  /**
   * Returns the attribution report for the current session.
   * Averages over an empty set are 0, never NaN.
   */
  getAttribution(): ReplayAttribution {
    const signals = [...this.signals.values()];
    const filled = signals.filter((s) => s.outcome === "filled");
    const closed = signals.filter((s) => s.realizedPnl !== null);

    const byStrategy: Record<string, StrategyAttributionSummary> = {};
    for (const s of signals) {
      const summary = byStrategy[s.strategyId] ??= {
        totalSignals: 0, filledSignals: 0, totalRealizedPnl: 0, winRate: 0,
      };
      summary.totalSignals++;
      if (s.outcome === "filled") summary.filledSignals++;
      summary.totalRealizedPnl += s.realizedPnl ?? 0;
    }
    for (const [strategyId, summary] of Object.entries(byStrategy)) {
      summary.winRate = winRate(closed.filter((s) => s.strategyId === strategyId));
    }

    return {
      sessionId: this.sessionId ?? "",
      totalSignals: signals.length,
      filledSignals: filled.length,
      fillRate: ratio(filled.length, signals.length),
      totalRealizedPnl: closed.reduce((sum, s) => sum + s.realizedPnl!, 0),
      winRate: winRate(closed),
      avgSlippageBps: mean(filled.map((s) => s.slippageBps).filter(isNumber)),
      avgHoldingTimeMs: mean(signals.map((s) => s.holdingTimeMs).filter(isNumber)),
      maxDrawdown: maxDrawdown(this.equityCurve),
      signals: signals.map((s) => ({ ...s })),
      equityCurve: [...this.equityCurve],
      byStrategy,
    };
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  private _onEvent(event: TradingEvent): void {
    switch (event.type) {
      case "QUOTE_RECEIVED":
        this.lastMid.set(event.payload.symbol, (event.payload.bidPrice + event.payload.askPrice) / 2);
        break;
      case "TRADE_RECEIVED":
        this.lastMid.set(event.payload.symbol, event.payload.price);
        break;
      case "BAR_RECEIVED":
        this.lastMid.set(event.payload.symbol, event.payload.close);
        break;
      case "STRATEGY_SIGNAL_CREATED": {
        const signal = event.payload;
        const signalId = event.signalId ?? signal.id;
        this.signals.set(signalId, {
          signalId,
          strategyId: event.strategyId,
          symbol: signal.symbol,
          direction: signal.direction,
          signalTs: event.ts,
          signalMidPrice: this._midAt(signal.symbol),
          fillPrice: null,
          fillTs: null,
          slippageBps: null,
          realizedPnl: null,
          holdingTimeMs: null,
          outcome: "no_fill",
        });
        break;
      }
      case "ORDER_SUBMITTED":
        this.orders.set(event.payload.id, {
          signalId: event.payload.signalId,
          strategyId: event.payload.strategyId,
        });
        break;
      case "ORDER_FILLED":
      case "ORDER_PARTIAL_FILL":
        this._onFill(event.fill);
        break;
      case "RISK_REJECTED":
        this._reject(event.rejectedIntent?.signalId, "risk_rejected");
        break;
      case "CAPITAL_UNAVAILABLE":
        this._reject(event.signalId, "capital_unavailable");
        break;
      case "PORTFOLIO_UPDATED":
        this.equityCurve.push({ ts: event.ts, equity: event.payload.equity });
        break;
    }
  }

  private _midAt(symbol: string): number | null {
    return this.symbolState?.get(symbol)?.latestMid ?? this.lastMid.get(symbol) ?? null;
  }

  private _reject(signalId: UUID | undefined, outcome: "risk_rejected" | "capital_unavailable"): void {
    const signal = signalId ? this.signals.get(signalId) : undefined;
    if (signal && signal.outcome !== "filled") signal.outcome = outcome;
  }

  private _onFill(fill: Fill): void {
    const link = this.orders.get(fill.orderId);
    if (!link) return;
    const signal = link.signalId ? this.signals.get(link.signalId) : undefined;

    // The signal's own symbol prices its fill; a pair's other leg only moves P&L.
    if (signal && fill.symbol === signal.symbol) {
      const acc = this.fillAcc.get(signal.signalId) ?? { qty: 0, notional: 0 };
      acc.qty += fill.qty;
      acc.notional += fill.qty * fill.price;
      this.fillAcc.set(signal.signalId, acc);
      signal.fillPrice = acc.notional / acc.qty;
      signal.fillTs ??= fill.ts;
      signal.outcome = "filled";
      if (signal.signalMidPrice) {
        // Positive = paid away from the mid: above it on a buy, below on a sell.
        const sign = fill.side === "buy" ? 1 : -1;
        signal.slippageBps = sign * ((signal.fillPrice - signal.signalMidPrice) / signal.signalMidPrice) * 10_000;
      }
    }

    this._applyToPosition(`${link.strategyId}|${fill.symbol}`, fill, link.signalId);
  }

  /** FIFO: a fill against open lots closes them first; any remainder opens a new lot. */
  private _applyToPosition(key: string, fill: Fill, signalId: UUID | undefined): void {
    const lots = this.lots.get(key) ?? [];
    let remaining = fill.side === "buy" ? fill.qty : -fill.qty;

    while (remaining !== 0 && lots.length > 0 && Math.sign(lots[0].qty) !== Math.sign(remaining)) {
      const lot = lots[0];
      const lotSign = Math.sign(lot.qty);
      const closeQty = Math.min(Math.abs(lot.qty), Math.abs(remaining));
      lot.qty -= closeQty * lotSign;
      // remaining has the opposite sign, so this moves it toward zero.
      remaining += closeQty * lotSign;
      this._creditClose(lot.signalId, (fill.price - lot.price) * closeQty * lotSign, fill.ts - lot.ts);
      if (lot.qty === 0) lots.shift();
    }

    if (remaining !== 0) lots.push({ qty: remaining, price: fill.price, ts: fill.ts, signalId });
    this.lots.set(key, lots);
  }

  private _creditClose(signalId: UUID | undefined, pnl: number, holdingMs: number): void {
    const opener = signalId ? this.signals.get(signalId) : undefined;
    if (!opener) return;
    opener.realizedPnl = (opener.realizedPnl ?? 0) + pnl;
    opener.holdingTimeMs = Math.max(opener.holdingTimeMs ?? 0, holdingMs);
  }
}

function isNumber(v: number | null): v is number {
  return v !== null && Number.isFinite(v);
}

function ratio(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function winRate(closed: SignalAttribution[]): number {
  return ratio(closed.filter((s) => s.realizedPnl! > 0).length, closed.length);
}

/** Largest peak-to-trough fall as a fraction of the peak. */
function maxDrawdown(curve: Array<{ equity: number }>): number {
  let peak = -Infinity;
  let worst = 0;
  for (const { equity } of curve) {
    peak = Math.max(peak, equity);
    if (peak > 0) worst = Math.max(worst, (peak - equity) / peak);
  }
  return worst;
}
