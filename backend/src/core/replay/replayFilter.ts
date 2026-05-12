/**
 * core/replay/replayFilter.ts
 *
 * Filters a TradingEvent array before loading it into the ReplayEngine.
 * All active filter fields are ANDed. Events with no symbol field (system,
 * portfolio) pass through symbol filters unchanged.
 *
 * Inputs:  TradingEvent[], ReplayFilter
 * Outputs: Filtered TradingEvent[]
 */

import type { TradingEvent } from "../../types/events";
import type { ReplayFilter } from "../../types/replay";

/**
 * Returns a filtered subset of events matching all active filter constraints.
 * Omitting a filter field means no constraint on that dimension.
 *
 * TODO: Implement filtering logic for each field:
 *   - eventTypes: only include events whose type is in the set
 *   - symbols: only include events whose payload.symbol is in the set;
 *              events with no symbol field always pass through
 *   - startTs / endTs: bounds on event.ts (inclusive)
 *
 * @param events - Source event array (not mutated)
 * @param filter - Filter constraints to apply
 * @returns New array containing only matching events
 */
export function applyFilter(events: TradingEvent[], _filter: ReplayFilter): TradingEvent[] {
  // TODO: implement
  return events;
}
