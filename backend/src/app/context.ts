import type { Orchestrator } from "../core/engine/orchestrator";
import type { SymbolStateManager } from "../core/state/symbolState";
import type { ReplayEngine } from "../core/replay/replayEngine";

/** Minimal interface for subscribing to market data symbols at runtime. */
export interface MarketDataSubscriber {
  subscribe(symbols: string[]): void;
}

export interface AppContext {
  orchestrator?: Orchestrator;
  symbolState?: SymbolStateManager;
  replayEngine?: ReplayEngine;
  /** Used by startStrategyRun to subscribe new symbols when a strategy starts at runtime. */
  marketDataAdapter?: MarketDataSubscriber;
}
