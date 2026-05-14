import type { Orchestrator } from "../core/engine/orchestrator";
import type { SymbolStateManager } from "../core/state/symbolState";
import type { PortfolioStateManager } from "../core/state/portfolioState";
import type { ReplayEngine } from "../core/replay/replayEngine";
import type { RiskEngine } from "../core/risk/riskEngine";

/** Minimal interface for subscribing to market data symbols at runtime. */
export interface MarketDataSubscriber {
  subscribe(symbols: string[]): void;
}

export interface AppContext {
  orchestrator?: Orchestrator;
  symbolState?: SymbolStateManager;
  portfolioState?: PortfolioStateManager;
  replayEngine?: ReplayEngine;
  riskEngine?: RiskEngine;
  /** Used by startStrategyRun to subscribe new symbols when a strategy starts at runtime. */
  marketDataAdapter?: MarketDataSubscriber;
  /** Execution mode of the current runtime — used to label strategy runs created via the API. */
  executionMode?: string;
}
