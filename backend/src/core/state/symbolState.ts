/**
 * core/state/symbolState.ts
 *
 * Per-symbol in-memory state manager. Maintains rolling windows of quotes,
 * trades, midprices, and spreads, along with the latest snapshot for each
 * tracked symbol. Strategies query this to compute signals.
 *
 * Inputs:  Normalized Quote, Trade, Bar events from the EventBus handlers.
 * Outputs: Current symbol state and rolling windows queried by strategies.
 */

import { RollingTimeWindow } from "./rollingWindow";
import { DEFAULT_WINDOWS } from "../../config/defaults";
import { barEndMs } from "../../utils/time";
import type { Quote, Trade, Bar, TradeCorrection, TradeCancel } from "../../types/market";
import type { EpochMs, Symbol } from "../../types/common";

// ------------------------------------------------------------------
// Per-symbol state shape
// ------------------------------------------------------------------

export interface SymbolState {
  symbol: Symbol;

  // Latest values
  latestQuote: Quote | null;
  latestTrade: Trade | null;
  latestBar: Bar | null;
  latestBid: number | null;
  latestAsk: number | null;
  latestMid: number | null;
  /**
   * When latestMid became known: the quote's time, or a bar's end (not its
   * start) when a bar close set it. Staleness checks measure age from here.
   */
  latestMidTs: EpochMs | null;
  latestSpread: number | null;

  // Rolling windows (60 s). Each starts recording the first time it is read:
  // nothing in the platform reads them, so keeping all four current on every
  // quote was pure overhead. A strategy that reads one sees history from that
  // first read on.
  quotesWindow: RollingTimeWindow<Quote>;
  tradesWindow: RollingTimeWindow<Trade>;
  midpricesWindow: RollingTimeWindow<number>;
  spreadsWindow: RollingTimeWindow<number>;

  // Update counters (for diagnostics)
  quoteCount: number;
  tradeCount: number;
  barCount: number;
}

// ------------------------------------------------------------------
// SymbolStateManager
// ------------------------------------------------------------------

export class SymbolStateManager {
  private states: Map<Symbol, SymbolState> = new Map();

  /**
   * Returns the current state for a symbol, creating it if not yet tracked.
   * @param symbol - Ticker symbol
   * @returns SymbolState for the given symbol
   */
  getOrCreate(symbol: Symbol): SymbolState {
    if (!this.states.has(symbol)) {
      this.states.set(symbol, this._createInitialState(symbol));
    }
    return this.states.get(symbol)!;
  }

  /**
   * Returns the current state for a symbol, or null if not tracked.
   * @param symbol - Ticker symbol
   * @returns SymbolState or null
   */
  get(symbol: Symbol): SymbolState | null {
    return this.states.get(symbol) ?? null;
  }

  /**
   * Returns all tracked symbols.
   * @returns Array of Symbol strings
   */
  getSymbols(): Symbol[] {
    return [...this.states.keys()];
  }

  /**
   * Handles a new quote event: updates latest values and rolling windows.
   * Called by the Orchestrator when a QUOTE_RECEIVED event arrives.
   * @param quote - Normalized Quote
   */
  onQuote(quote: Quote): void {
    const state = this.getOrCreate(quote.symbol);
    state.latestQuote = quote;
    state.latestBid = quote.bidPrice;
    state.latestAsk = quote.askPrice;
    state.latestMid = quote.midPrice;
    state.latestMidTs = quote.ts;
    state.latestSpread = quote.spread;
    state.quoteCount++;
    if (state instanceof SymbolStateRecord) state.trackQuote(quote);
  }

  /**
   * Handles a new trade event: updates latest trade and trade window.
   * @param trade - Normalized Trade
   */
  onTrade(trade: Trade): void {
    const state = this.getOrCreate(trade.symbol);
    state.latestTrade = trade;
    state.tradeCount++;
    if (state instanceof SymbolStateRecord) state.trackTrade(trade);
  }

  /**
   * Handles a new bar event: updates the latest bar.
   * @param bar - Normalized Bar
   */
  onBar(bar: Bar): void {
    const state = this.getOrCreate(bar.symbol);
    state.latestBar = bar;
    state.barCount++;
    // Fallback: a bar close stands in for the mid so quote-based code can run
    // on bars — but only when nothing fresher is known. A quote received after
    // the bar completed is the better current price.
    const endTs = barEndMs(bar);
    if (state.latestMidTs === null || endTs >= state.latestMidTs) {
      state.latestMid = bar.close;
      state.latestMidTs = endTs;
    }
  }

  /**
   * Applies a revised bar (a late trade changed it). Replaces the stored bar
   * only when it is the same interval, and moves latestMid only when the mid
   * came from that bar's close. Returns true when state changed.
   * @param bar - The revised bar
   */
  onBarRevised(bar: Bar): boolean {
    const state = this.states.get(bar.symbol);
    const current = state?.latestBar;
    if (!state || !current || current.ts !== bar.ts || current.timeframe !== bar.timeframe) return false;
    state.latestBar = bar;
    if (state.latestMidTs === barEndMs(current) && state.latestMid === current.close) state.latestMid = bar.close;
    return true;
  }

  /**
   * Applies a trade correction: the latest trade is replaced when it is the
   * corrected print. Returns true when state changed.
   */
  onTradeCorrected(correction: TradeCorrection): boolean {
    const state = this.states.get(correction.symbol);
    if (!state?.latestTrade || state.latestTrade.id !== correction.originalId) return false;
    state.latestTrade = correction.corrected;
    return true;
  }

  /**
   * Applies a trade cancel/error: if the latest trade is the cancelled print it
   * is cleared (the previous print is not known here). Returns true when state changed.
   */
  onTradeCanceled(cancel: TradeCancel): boolean {
    const state = this.states.get(cancel.symbol);
    if (!state?.latestTrade || state.latestTrade.id !== cancel.tradeId) return false;
    state.latestTrade = null;
    return true;
  }

  /**
   * Clears all state for all symbols. Used in tests and resets.
   */
  clear(): void {
    this.states.clear();
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  private _createInitialState(symbol: Symbol): SymbolState {
    return new SymbolStateRecord(symbol);
  }
}

/**
 * SymbolState with rolling windows that are created on first read and only
 * maintained from then on. JSON serialization leaves them out (they are
 * accessors, not own properties).
 */
class SymbolStateRecord implements SymbolState {
  latestQuote: Quote | null = null;
  latestTrade: Trade | null = null;
  latestBar: Bar | null = null;
  latestBid: number | null = null;
  latestAsk: number | null = null;
  latestMid: number | null = null;
  latestMidTs: EpochMs | null = null;
  latestSpread: number | null = null;
  quoteCount = 0;
  tradeCount = 0;
  barCount = 0;
  #quotes: RollingTimeWindow<Quote> | null = null;
  #trades: RollingTimeWindow<Trade> | null = null;
  #mids: RollingTimeWindow<number> | null = null;
  #spreads: RollingTimeWindow<number> | null = null;

  constructor(readonly symbol: Symbol) {}

  get quotesWindow(): RollingTimeWindow<Quote> {
    return (this.#quotes ??= new RollingTimeWindow(DEFAULT_WINDOWS.medium));
  }

  get tradesWindow(): RollingTimeWindow<Trade> {
    return (this.#trades ??= new RollingTimeWindow(DEFAULT_WINDOWS.medium));
  }

  get midpricesWindow(): RollingTimeWindow<number> {
    return (this.#mids ??= new RollingTimeWindow(DEFAULT_WINDOWS.medium));
  }

  get spreadsWindow(): RollingTimeWindow<number> {
    return (this.#spreads ??= new RollingTimeWindow(DEFAULT_WINDOWS.medium));
  }

  /** Pushes into whichever quote-derived windows have been read. */
  trackQuote(quote: Quote): void {
    this.#quotes?.push({ ts: quote.ts, value: quote });
    this.#mids?.push({ ts: quote.ts, value: quote.midPrice });
    this.#spreads?.push({ ts: quote.ts, value: quote.spread });
  }

  trackTrade(trade: Trade): void {
    this.#trades?.push({ ts: trade.ts, value: trade });
  }
}
