/**
 * core/replay/attributionCollector.ts
 *
 * Accumulates per-signal and portfolio metrics during a replay with
 * replayStrategies: true. Subscribes to the EventBus and correlates
 * STRATEGY_SIGNAL_CREATED → ORDER_FILLED / RISK_REJECTED / CAPITAL_UNAVAILABLE
 * to build a full ReplayAttribution report.
 *
 * Inputs:  EventBus events published during replay; optional SymbolStateManager
 *          for mid-price capture at signal time.
 * Outputs: ReplayAttribution via getAttribution()
 */

import type { EventBus } from "../engine/eventBus";
import type { SymbolStateManager } from "../state/symbolState";
import type { ReplayAttribution } from "../../types/replay";
import type { UUID } from "../../types/common";

export class AttributionCollector {
  constructor(
    private readonly eventBus: EventBus,
    /** Provides mid price lookup at the moment a signal fires.
     *  Only available when an Orchestrator is running alongside the ReplayEngine. */
    private readonly symbolState?: SymbolStateManager,
  ) {}

  /**
   * Begins collection for the given session. Subscribes to all EventBus events.
   * @param sessionId - ID of the active ReplaySession
   *
   * TODO: Subscribe to STRATEGY_SIGNAL_CREATED, ORDER_FILLED, RISK_REJECTED,
   *       CAPITAL_UNAVAILABLE, and PORTFOLIO_UPDATED events. For each:
   *         - STRATEGY_SIGNAL_CREATED: record signal with mid price from symbolState
   *         - ORDER_FILLED: match fill to open signal by symbol, compute slippage bps
   *         - RISK_REJECTED / CAPITAL_UNAVAILABLE: mark matching open signal and close it
   *         - PORTFOLIO_UPDATED: append { ts, equity } to equityCurve
   */
  start(_sessionId: UUID): void {
    // TODO: implement
  }

  /**
   * Stops collection and unsubscribes from the EventBus.
   */
  stop(): void {
    // TODO: implement
  }

  /**
   * Returns the attribution report for the current session.
   *
   * TODO: Compute aggregate fields from collected signal and equity data:
   *   fillRate, winRate, avgSlippageBps, avgHoldingTimeMs, maxDrawdown, byStrategy
   */
  getAttribution(): ReplayAttribution {
    // TODO: implement
    throw new Error("AttributionCollector.getAttribution() not yet implemented");
  }
}
