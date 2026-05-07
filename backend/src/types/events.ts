/**
 * events.ts
 *
 * Internal event type definitions for the event-driven architecture.
 * Every component communicates through these normalized event types,
 * enabling loose coupling, replay support, and backtest/live reuse.
 *
 * Inputs:  Raw data from adapters (Alpaca, simulated sources).
 * Outputs: Typed event objects published to the EventBus.
 */

import type { EpochMs, Symbol, UUID, OrderSide, OrderStatus, ExecutionMode } from "./common";
import type { Quote, Trade, Bar } from "./market";
import type { OrderIntent, Order, Fill } from "./orders";
import type { PortfolioSnapshot } from "./portfolio";
import type { StrategySignal } from "./strategy";
import type { ReplayStatus, ReplaySpeed } from "./replay";

// ------------------------------------------------------------------
// Event Type Enum
// ------------------------------------------------------------------

/** Exhaustive list of all internal event types in the system. */
export type EventType =
  // Market data events
  | "QUOTE_RECEIVED"
  | "TRADE_RECEIVED"
  | "BAR_RECEIVED"
  // Order lifecycle events
  | "ORDER_INTENT_CREATED"
  | "ORDER_SUBMITTED"
  | "ORDER_ACKNOWLEDGED"
  | "ORDER_PARTIAL_FILL"
  | "ORDER_FILLED"
  | "ORDER_CANCELED"
  | "ORDER_REJECTED"
  | "ORDER_EXPIRED"
  // Portfolio events
  | "PORTFOLIO_UPDATED"
  // Strategy events
  | "STRATEGY_SIGNAL_CREATED"
  | "STRATEGY_STARTED"
  | "STRATEGY_STOPPED"
  | "STRATEGY_ERROR"
  // Risk events
  | "RISK_REJECTED"
  // OMS events
  | "CAPITAL_RESERVED"
  | "CAPITAL_RELEASED"
  | "CAPITAL_UNAVAILABLE"
  | "ORDER_QUEUED"
  | "CHILD_ORDER_CREATED"
  // System events
  | "ENGINE_STARTED"
  | "ENGINE_STOPPED"
  | "HEARTBEAT"
  // Replay events
  | "REPLAY_TICK";

// ------------------------------------------------------------------
// Base Event
// ------------------------------------------------------------------

/** Base shape shared by every internal event. */
export interface BaseEvent {
  /** Unique event ID */
  id: UUID;
  /** Event type discriminator */
  type: EventType;
  /** When the event was created (Unix ms) */
  ts: EpochMs;
  /** Execution mode context */
  mode: ExecutionMode;
  /** Simulated clock time for backtest/replay modes (Unix ms) */
  simulatedTs?: EpochMs;
}

// ------------------------------------------------------------------
// Market Data Events
// ------------------------------------------------------------------

export interface QuoteReceivedEvent extends BaseEvent {
  type: "QUOTE_RECEIVED";
  payload: Quote;
}

export interface TradeReceivedEvent extends BaseEvent {
  type: "TRADE_RECEIVED";
  payload: Trade;
}

export interface BarReceivedEvent extends BaseEvent {
  type: "BAR_RECEIVED";
  payload: Bar;
}

// ------------------------------------------------------------------
// Order Lifecycle Events
// ------------------------------------------------------------------

export interface OrderIntentCreatedEvent extends BaseEvent {
  type: "ORDER_INTENT_CREATED";
  payload: OrderIntent;
  /** ID of the strategy that generated this intent */
  strategyId: string;
}

export interface OrderSubmittedEvent extends BaseEvent {
  type: "ORDER_SUBMITTED";
  payload: Order;
}

export interface OrderAcknowledgedEvent extends BaseEvent {
  type: "ORDER_ACKNOWLEDGED";
  orderId: UUID;
  brokerOrderId: string;
}

export interface OrderPartialFillEvent extends BaseEvent {
  type: "ORDER_PARTIAL_FILL";
  orderId: UUID;
  fill: Fill;
  remainingQty: number;
}

export interface OrderFilledEvent extends BaseEvent {
  type: "ORDER_FILLED";
  orderId: UUID;
  fill: Fill;
}

export interface OrderCanceledEvent extends BaseEvent {
  type: "ORDER_CANCELED";
  orderId: UUID;
  reason?: string;
}

export interface OrderRejectedEvent extends BaseEvent {
  type: "ORDER_REJECTED";
  orderId: UUID;
  reason: string;
}

export interface OrderExpiredEvent extends BaseEvent {
  type: "ORDER_EXPIRED";
  orderId: UUID;
}

// ------------------------------------------------------------------
// Portfolio Events
// ------------------------------------------------------------------

export interface PortfolioUpdatedEvent extends BaseEvent {
  type: "PORTFOLIO_UPDATED";
  payload: PortfolioSnapshot;
}

// ------------------------------------------------------------------
// Strategy Events
// ------------------------------------------------------------------

export interface StrategySignalCreatedEvent extends BaseEvent {
  type: "STRATEGY_SIGNAL_CREATED";
  strategyId: string;
  payload: StrategySignal;
}

export interface StrategyStartedEvent extends BaseEvent {
  type: "STRATEGY_STARTED";
  strategyId: string;
  strategyType: string;
}

export interface StrategyStoppedEvent extends BaseEvent {
  type: "STRATEGY_STOPPED";
  strategyId: string;
  reason?: string;
}

export interface StrategyErrorEvent extends BaseEvent {
  type: "STRATEGY_ERROR";
  strategyId: string;
  /** Human-readable name from the strategy's saved config, if available */
  strategyName?: string;
  /** String(err) from the thrown exception */
  error: string;
  /** Which lifecycle phase the error occurred in */
  phase: "evaluate" | "start" | "stop";
}

// ------------------------------------------------------------------
// Risk Events
// ------------------------------------------------------------------

export interface RiskRejectedEvent extends BaseEvent {
  type: "RISK_REJECTED";
  strategyId: string;
  orderId?: UUID;
  reason: string;
  /** The intent that was rejected */
  rejectedIntent: OrderIntent;
}

// ------------------------------------------------------------------
// OMS Events
// ------------------------------------------------------------------

export interface CapitalReservedEvent extends BaseEvent {
  type: "CAPITAL_RESERVED";
  /** Reservation receipt ID */
  reservationId: UUID;
  /** Amount reserved in USD */
  amount: number;
  /** Intent this reservation covers */
  intentId: UUID;
  /** Strategy that owns the reservation */
  strategyId: string;
}

export interface CapitalReleasedEvent extends BaseEvent {
  type: "CAPITAL_RELEASED";
  /** Reservation being released */
  reservationId: UUID;
  /** Why the reservation was released */
  reason: "filled" | "canceled" | "rejected";
}

export interface CapitalUnavailableEvent extends BaseEvent {
  type: "CAPITAL_UNAVAILABLE";
  /** Intent that could not be reserved */
  intentId: UUID;
  /** Strategy that submitted the intent */
  strategyId: string;
  /** USD amount required */
  required: number;
  /** USD amount available after existing reservations */
  available: number;
}

export interface OrderQueuedEvent extends BaseEvent {
  type: "ORDER_QUEUED";
  /** Intent that was enqueued */
  intentId: UUID;
  /** Strategy that owns the intent */
  strategyId: string;
  /** Priority assigned in the queue */
  priority: number;
  /** Queue depth after enqueue */
  queueDepth: number;
}

export interface ChildOrderCreatedEvent extends BaseEvent {
  type: "CHILD_ORDER_CREATED";
  /** Parent intent this child belongs to */
  parentIntentId: UUID;
  /** Child intent that was submitted */
  childIntentId: UUID;
  /** Zero-based index of this slice */
  sliceIndex: number;
  /** Total number of slices for the parent */
  totalSlices: number;
}

// ------------------------------------------------------------------
// System Events
// ------------------------------------------------------------------

export interface EngineStartedEvent extends BaseEvent {
  type: "ENGINE_STARTED";
  mode: ExecutionMode;
}

export interface EngineStoppedEvent extends BaseEvent {
  type: "ENGINE_STOPPED";
  mode: ExecutionMode;
}

export interface HeartbeatEvent extends BaseEvent {
  type: "HEARTBEAT";
}

// ------------------------------------------------------------------
// Replay Events
// ------------------------------------------------------------------

/**
 * Published by the ReplayEngine after every event emission.
 * Carries the current playback state so the frontend can update
 * progress, status, and simulated time in real time over WebSocket
 * without polling the status endpoint.
 *
 * ts on this event is always wall-clock time (Date.now()), not simulated
 * time, so the WebSocket message carries an accurate delivery timestamp.
 */
export interface ReplayTickEvent extends BaseEvent {
  type: "REPLAY_TICK";
  /** ID of the active ReplaySession */
  sessionId: UUID;
  /** Current cursor position after emitting this tick's event */
  cursor: number;
  /** Total number of events in the filtered session */
  totalEvents: number;
  /** Playback status after this tick */
  status: ReplayStatus;
  /** Active playback speed */
  speed: ReplaySpeed;
  /** Simulated clock time of the event that was just emitted */
  simulatedNow: EpochMs;
}

// ------------------------------------------------------------------
// Discriminated Union
// ------------------------------------------------------------------

/** Union of all possible internal events. Use `event.type` to narrow. */
export type TradingEvent =
  | QuoteReceivedEvent
  | TradeReceivedEvent
  | BarReceivedEvent
  | OrderIntentCreatedEvent
  | OrderSubmittedEvent
  | OrderAcknowledgedEvent
  | OrderPartialFillEvent
  | OrderFilledEvent
  | OrderCanceledEvent
  | OrderRejectedEvent
  | OrderExpiredEvent
  | PortfolioUpdatedEvent
  | StrategySignalCreatedEvent
  | StrategyStartedEvent
  | StrategyStoppedEvent
  | StrategyErrorEvent
  | RiskRejectedEvent
  | CapitalReservedEvent
  | CapitalReleasedEvent
  | CapitalUnavailableEvent
  | OrderQueuedEvent
  | ChildOrderCreatedEvent
  | EngineStartedEvent
  | EngineStoppedEvent
  | HeartbeatEvent
  | ReplayTickEvent;

/** Typed event handler callback */
export type EventHandler<E extends TradingEvent = TradingEvent> = (event: E) => void | Promise<void>;
