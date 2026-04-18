import type { Orchestrator } from "../core/engine/orchestrator";
import type { SymbolStateManager } from "../core/state/symbolState";
import type { ReplayEngine } from "../core/replay/replayEngine";

export interface AppContext {
  orchestrator?: Orchestrator;
  symbolState?: SymbolStateManager;
  replayEngine?: ReplayEngine;
}
