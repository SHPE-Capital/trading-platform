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
import type { TradingEvent } from "./events";

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
  | { action: "set_speed"; speed: ReplaySpeed }
  | { action: "reset" };

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
