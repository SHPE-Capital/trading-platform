/**
 * core/replay/replayEngine.ts
 *
 * Replay engine. Plays back a recorded TradingEvent stream through the
 * EventBus at a configurable speed. Supports pause, resume, step, seek,
 * and speed control for debugging and strategy inspection.
 *
 * While each recorded event is published, nowMs() returns that event's ts, so
 * handlers see the recorded time rather than the wall clock. The override is
 * installed only for the synchronous publish and refused (wall clock kept) in
 * a process whose clock a trading engine has locked.
 *
 * Progress goes out as REPLAY_TICK: after every control command, on
 * completion, and at most every TICK_INTERVAL_MS during playback.
 *
 * Inputs:  ReplaySession with a recorded event array and playback controls.
 * Outputs: TradingEvents re-published to the EventBus; REPLAY_TICK progress;
 *          session state updates.
 */

import { EventBus } from "../engine/eventBus";
import { logger } from "../../utils/logger";
import { newId } from "../../utils/ids";
import { setClockOverride, isClockLockedForLive } from "../../utils/time";
import type { TradingEvent } from "../../types/events";
import type { ReplaySession, ReplayCommand, ReplaySpeed } from "../../types/replay";

/** A session as the API reports it: everything but the event array. */
export type ReplaySessionStatus = Omit<ReplaySession, "events">;

/** Minimum wall-clock gap between REPLAY_TICKs while playing. */
const TICK_INTERVAL_MS = 100;

export class ReplayEngine {
  private session: ReplaySession | null = null;
  private playbackTimer: NodeJS.Timeout | null = null;
  private lastTickAt = 0;

  constructor(private readonly eventBus: EventBus) {}

  /**
   * Loads a replay session and prepares it for playback.
   * Does not start playback automatically.
   * @param session - The ReplaySession to load
   */
  load(session: ReplaySession): void {
    this.stop();
    this.session = session;
    logger.info("ReplayEngine: session loaded", {
      id: session.id,
      totalEvents: session.totalEvents,
    });
  }

  /**
   * Applies a playback control command to the active session.
   * @param command - ReplayCommand to apply
   */
  control(command: ReplayCommand): void {
    if (!this.session) return;

    switch (command.action) {
      case "play":
        this._play();
        break;
      case "pause":
        this._pause();
        break;
      case "step":
        this._step();
        break;
      case "seek":
        this._seek(command.targetIndex);
        break;
      case "seek_ts":
        this._seek(this._indexAtOrAfter(command.targetTs));
        break;
      case "set_speed":
        this._setSpeed(command.speed);
        break;
      case "reset":
        this._reset();
        break;
    }
    this._publishTick();
  }

  /**
   * Returns the current session state, or null if no session is loaded.
   * @returns ReplaySession or null
   */
  getSession(): ReplaySession | null {
    return this.session ? { ...this.session } : null;
  }

  /**
   * The current session without its events — what status responses carry, so
   * a poll does not serialize the whole recording.
   * @returns ReplaySessionStatus or null
   */
  getStatus(): ReplaySessionStatus | null {
    if (!this.session) return null;
    const { events: _events, ...status } = this.session;
    return status;
  }

  /**
   * Stops playback and unloads the current session.
   */
  stop(): void {
    this._clearTimer();
    if (this.session) {
      this.session.status = "idle";
    }
    this.session = null;
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  private _play(): void {
    if (!this.session || this.session.status === "completed") return;
    this.session.status = "playing";
    this._scheduleNext();
  }

  private _pause(): void {
    if (!this.session) return;
    this._clearTimer();
    this.session.status = "paused";
  }

  private _step(): void {
    if (!this.session) return;
    this._clearTimer();
    this._emitNext();
  }

  private _seek(targetIndex: number): void {
    if (!this.session) return;
    this._clearTimer();
    this.session.cursor = Math.max(0, Math.min(targetIndex, this.session.totalEvents - 1));
    if (this.session.status === "completed") this.session.status = "paused";
    if (this.session.status === "playing") {
      this._scheduleNext();
    }
  }

  /** Index of the first event with ts >= targetTs (events are in time order). */
  private _indexAtOrAfter(targetTs: number): number {
    const events = this.session!.events;
    let lo = 0;
    let hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (events[mid].ts < targetTs) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private _setSpeed(speed: ReplaySpeed): void {
    if (!this.session) return;
    this.session.speed = speed;
    if (this.session.status === "playing") {
      this._clearTimer();
      this._scheduleNext();
    }
  }

  private _reset(): void {
    if (!this.session) return;
    this._clearTimer();
    this.session.cursor = 0;
    this.session.status = "paused";
    this.session.simulatedNow = this.session.events[0]?.ts ?? Date.now();
  }

  private _scheduleNext(): void {
    if (!this.session || this.session.status !== "playing") return;
    if (this.session.speed === "step") return;

    const current = this.session.events[this.session.cursor];
    const next = this.session.events[this.session.cursor + 1];

    if (!next || !current) {
      this._emitNext();
      return;
    }

    const realGapMs = next.ts - current.ts;
    const delayMs = Math.max(0, realGapMs / (this.session.speed as number));

    this.playbackTimer = setTimeout(() => {
      this._emitNext();
      this._scheduleNext();
    }, delayMs);
  }

  private _emitNext(): void {
    if (!this.session) return;
    if (this.session.cursor >= this.session.totalEvents) {
      this.session.status = "completed";
      logger.info("ReplayEngine: playback completed", { id: this.session.id });
      return;
    }

    const event = this.session.events[this.session.cursor];
    this.session.simulatedNow = event.ts;
    this._publishAtRecordedTime(event);
    this.session.cursor++;

    if (this.session.cursor >= this.session.totalEvents) {
      this.session.status = "completed";
      logger.info("ReplayEngine: playback completed", { id: this.session.id });
      this._publishTick();
    } else if (this.session.status === "playing" && Date.now() - this.lastTickAt >= TICK_INTERVAL_MS) {
      this._publishTick();
    }
  }

  private _publishAtRecordedTime(event: TradingEvent): void {
    if (isClockLockedForLive()) {
      this.eventBus.publish(event);
      return;
    }
    setClockOverride(() => event.ts);
    try {
      this.eventBus.publish(event);
    } finally {
      setClockOverride(null);
    }
  }

  /** ts is wall-clock delivery time, not simulated time (see ReplayTickEvent). */
  private _publishTick(): void {
    if (!this.session) return;
    this.lastTickAt = Date.now();
    this.eventBus.publish({
      id: newId(),
      type: "REPLAY_TICK",
      ts: this.lastTickAt,
      mode: "replay",
      sessionId: this.session.id,
      cursor: this.session.cursor,
      totalEvents: this.session.totalEvents,
      status: this.session.status,
      speed: this.session.speed,
      simulatedNow: this.session.simulatedNow,
    });
  }

  private _clearTimer(): void {
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
  }
}
