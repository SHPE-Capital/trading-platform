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
 * The symbol an event is about, or undefined for events that have none.
 * Market data, orders, intents and signals carry it on payload; fills on
 * fill; risk rejections on the rejected intent.
 */
export function eventSymbol(event: TradingEvent): string | undefined {
  const e = event as {
    payload?: { symbol?: unknown };
    fill?: { symbol?: unknown };
    rejectedIntent?: { symbol?: unknown };
  };
  const symbol = e.payload?.symbol ?? e.fill?.symbol ?? e.rejectedIntent?.symbol;
  return typeof symbol === "string" ? symbol : undefined;
}

/** True when no field of the filter would constrain anything. */
export function isEmptyFilter(filter: ReplayFilter): boolean {
  return !filter.eventTypes?.length
    && !filter.symbols?.length
    && filter.startTs === undefined
    && filter.endTs === undefined;
}

/**
 * Returns a filtered subset of events matching all active filter constraints.
 * Omitting a filter field means no constraint on that dimension.
 *
 * @param events - Source event array (not mutated)
 * @param filter - Filter constraints to apply
 * @returns New array containing only matching events
 */
export function applyFilter(events: TradingEvent[], filter: ReplayFilter): TradingEvent[] {
  const types = filter.eventTypes?.length ? new Set<string>(filter.eventTypes) : null;
  const symbols = filter.symbols?.length
    ? new Set(filter.symbols.map((s) => s.trim().toUpperCase()))
    : null;
  const { startTs, endTs } = filter;

  return events.filter((event) => {
    if (types && !types.has(event.type)) return false;
    if (startTs !== undefined && event.ts < startTs) return false;
    if (endTs !== undefined && event.ts > endTs) return false;
    if (symbols) {
      const symbol = eventSymbol(event);
      if (symbol !== undefined && !symbols.has(symbol.toUpperCase())) return false;
    }
    return true;
  });
}
