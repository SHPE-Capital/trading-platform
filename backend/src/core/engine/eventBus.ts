/**
 * core/engine/eventBus.ts
 *
 * The central event bus for the trading platform. All internal communication
 * flows through this bus via publish/subscribe. It enables loose coupling
 * between adapters, state, strategies, risk, and execution layers.
 *
 * The bus is synchronous by default to preserve event ordering, which is
 * critical for deterministic backtesting and replay.
 *
 * Inputs:  TradingEvent objects published by any layer.
 * Outputs: Dispatches events to all registered handlers for that event type.
 */

import type { TradingEvent, EventType, EventHandler } from "../../types/events";
import { logger } from "../../utils/logger";

export class EventBus {
  /**
   * Handler registry: eventType → list of handlers
   * Using "unknown" handlers here because TypeScript cannot narrow generics
   * from a string-keyed map; callers use typed `on<T>` for safety.
   */
  private handlers: Map<EventType, EventHandler[]> = new Map();

  /** Optional catch-all handlers subscribed to every event type */
  private wildcardHandlers: EventHandler[] = [];

  /**
   * Publishes a trading event to all registered subscribers.
   * Handlers are called synchronously in registration order.
   * Errors in individual handlers are caught and logged, not re-thrown.
   * @param event - The TradingEvent to dispatch
   */
  publish(event: TradingEvent): void {
    const handlers = this.handlers.get(event.type) ?? [];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        logger.error("EventBus: handler threw", {
          eventType: event.type,
          error: String(err),
        });
      }
    }
    for (const handler of this.wildcardHandlers) {
      try {
        handler(event);
      } catch (err) {
        logger.error("EventBus: wildcard handler threw", {
          eventType: event.type,
          error: String(err),
        });
      }
    }
  }

  /**
   * Registers a handler for a specific event type.
   * @param eventType - The EventType to subscribe to
   * @param handler - Callback invoked with each matching event
   */
  on<E extends TradingEvent>(eventType: E["type"], handler: EventHandler<E>): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler as EventHandler);
    this.handlers.set(eventType, existing);
  }

  /**
   * Removes a previously registered handler for an event type.
   * @param eventType - The EventType to unsubscribe from
   * @param handler - The exact handler reference to remove
   */
  off<E extends TradingEvent>(eventType: E["type"], handler: EventHandler<E>): void {
    const existing = this.handlers.get(eventType) ?? [];
    this.handlers.set(
      eventType,
      existing.filter((h) => h !== (handler as EventHandler)),
    );
  }

  /**
   * Registers a handler that receives every event regardless of type.
   * Useful for logging, recording, and replay capture.
   * @param handler - Callback invoked for every published event
   */
  onAll(handler: EventHandler): void {
    this.wildcardHandlers.push(handler);
  }

  /**
   * Removes a previously registered wildcard handler.
   * @param handler - The exact handler reference to remove
   */
  offAll(handler: EventHandler): void {
    this.wildcardHandlers = this.wildcardHandlers.filter((h) => h !== handler);
  }

  /**
   * Removes all handlers for all event types. Used in tests and teardown.
   */
  clear(): void {
    this.handlers.clear();
    this.wildcardHandlers = [];
  }

  /**
   * Returns the total number of registered handlers across all event types.
   * Useful for diagnostics and health checks.
   * @returns Total handler count
   */
  handlerCount(): number {
    let total = this.wildcardHandlers.length;
    for (const handlers of this.handlers.values()) {
      total += handlers.length;
    }
    return total;
  }
}
