import type { Orchestrator } from "../core/engine/orchestrator";
import type { SymbolStateManager } from "../core/state/symbolState";
import type { PortfolioStateManager } from "../core/state/portfolioState";
import type { ReplayEngine } from "../core/replay/replayEngine";
import type { RiskEngine } from "../core/risk/riskEngine";
import type { LiveRunCoordinator } from "../core/live/liveRunCoordinator";

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
  /**
   * Lease-holding run registry of a trading runtime (Part 05). Starting a run
   * goes through it so the run is warmed up and leased to this process;
   * stopping releases the lease.
   */
  liveRuns?: LiveRunCoordinator;
}
