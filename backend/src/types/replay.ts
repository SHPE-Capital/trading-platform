/**
 * replay.ts
 *
 * Types for replay mode: replaying a previously recorded event stream
 * through the engine for debugging, inspection, or comparison.
 *
 * Inputs:  Recorded TradingEvent array (from DB or file).
 * Outputs: ReplaySession state, playback control commands.
 */

import type { UUID, EpochMs, ISOTimestamp } from "./common";
import type { TradingEvent, EventType } from "./events";

// ------------------------------------------------------------------
// Replay Session
// ------------------------------------------------------------------

/** Playback speed multiplier */
export type ReplaySpeed = 0.25 | 0.5 | 1 | 2 | 5 | 10 | "step";

/** Lifecycle status of a replay session */
export type ReplayStatus = "idle" | "playing" | "paused" | "completed" | "error";

/** A configured replay session */
export interface ReplaySession {
  /** Session ID */
  id: UUID;
  /** Human-readable name (e.g. "SPY-AAPL pairs run 2024-03-15") */
  name: string;
  /** Source event log to replay */
  sourceRunId?: UUID;
  /** Events to replay (loaded into memory) */
  events: TradingEvent[];
  /** Total number of events in the session */
  totalEvents: number;
  /** Index of the current event (cursor position) */
  cursor: number;
  /** Current playback status */
  status: ReplayStatus;
  /** Playback speed multiplier */
  speed: ReplaySpeed;
  /** Whether strategy signals should be re-evaluated during replay */
  replayStrategies: boolean;
  /** Simulated current time during playback (Unix ms) */
  simulatedNow: EpochMs;
  /** When the session was created (wall-clock Unix ms) */
  createdAt: EpochMs;
  /** Optional description */
  description?: string;
}

// ------------------------------------------------------------------
// Replay Control Commands
// ------------------------------------------------------------------

export type ReplayCommand =
  | { action: "play" }
  | { action: "pause" }
  | { action: "step" }
  | { action: "seek"; targetIndex: number }
  | { action: "seek_ts"; targetTs: EpochMs }
  | { action: "set_speed"; speed: ReplaySpeed }
  | { action: "reset" };

// ------------------------------------------------------------------
// Recorded Event Log (persisted)
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Replay Filters
// ------------------------------------------------------------------

/**
 * Optional filter applied to an event log before loading into the engine.
 * All active fields are ANDed together. Omitting a field means no constraint.
 * At least one field must be set when the filter object is present.
 */
export interface ReplayFilter {
  /** Only include events whose type is in this list. */
  eventTypes?: EventType[];
  /** Only include events whose payload.symbol is in this list.
   *  Events with no symbol field (system, portfolio) always pass through. */
  symbols?: string[];
  /** Lower bound on event.ts (Unix ms, inclusive). */
  startTs?: EpochMs;
  /** Upper bound on event.ts (Unix ms, inclusive). */
  endTs?: EpochMs;
}

// ------------------------------------------------------------------
// Performance Attribution
// ------------------------------------------------------------------

/** Final outcome of a strategy signal during a replay with replayStrategies: true */
export type SignalOutcome =
  | "filled"
  | "risk_rejected"
  | "capital_unavailable"
  | "no_fill";

/** Attribution record for a single strategy signal */
export interface SignalAttribution {
  signalId: UUID;
  strategyId: string;
  symbol: string;
  direction: string;
  /** Simulated timestamp when the signal fired */
  signalTs: EpochMs;
  /** Mid price at the moment the signal fired (null if symbol state was unavailable) */
  signalMidPrice: number | null;
  fillPrice: number | null;
  fillTs: EpochMs | null;
  /** (fillPrice - signalMidPrice) / signalMidPrice × 10,000 */
  slippageBps: number | null;
  /** Realized PnL on round-trip close (null if position still open) */
  realizedPnl: number | null;
  holdingTimeMs: number | null;
  outcome: SignalOutcome;
}

/** Per-strategy summary inside a ReplayAttribution */
export interface StrategyAttributionSummary {
  totalSignals: number;
  filledSignals: number;
  totalRealizedPnl: number;
  /** Profitable closed round-trips / total closed round-trips */
  winRate: number;
}

/** Full attribution report produced after a completed replay with replayStrategies: true */
export interface ReplayAttribution {
  sessionId: UUID;
  totalSignals: number;
  filledSignals: number;
  /** filledSignals / totalSignals */
  fillRate: number;
  totalRealizedPnl: number;
  /** Profitable closed round-trips / total closed round-trips */
  winRate: number;
  avgSlippageBps: number;
  avgHoldingTimeMs: number;
  /** (peakEquity − troughEquity) / peakEquity */
  maxDrawdown: number;
  signals: SignalAttribution[];
  equityCurve: Array<{ ts: EpochMs; equity: number }>;
  /** Breakdown keyed by strategyId — populated when multiple strategies ran */
  byStrategy: Record<string, StrategyAttributionSummary>;
}

// ------------------------------------------------------------------
// Recorded Event Log (persisted)
// ------------------------------------------------------------------

/** Metadata record for a stored event log that can be replayed */
export interface EventLogRecord {
  id: UUID;
  name: string;
  description?: string;
  /** Source (live run, backtest, synthetic, etc.) */
  source: string;
  /** Originating run ID if from a live or backtest run */
  runId?: UUID;
  /** Number of events in the log */
  eventCount: number;
  /** Period covered (ISO 8601) */
  startDate: ISOTimestamp;
  endDate: ISOTimestamp;
  /** When this log was recorded */
  createdAt: EpochMs;
}
