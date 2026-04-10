/**
 * core/replay/replayEngine.ts
 *
 * Replay engine. Plays back a recorded TradingEvent stream through the
 * EventBus at a configurable speed. Supports pause, resume, step, seek,
 * and speed control for debugging and strategy inspection.
 *
 * Inputs:  ReplaySession with a recorded event array and playback controls.
 * Outputs: TradingEvents re-published to the EventBus; session state updates.
 */

import { EventBus } from "../engine/eventBus";
import { logger } from "../../utils/logger";
import type { TradingEvent } from "../../types/events";
import type { ReplaySession, ReplayCommand, ReplaySpeed } from "../../types/replay";

export class ReplayEngine {
  private session: ReplaySession | null = null;
  private playbackTimer: NodeJS.Timeout | null = null;

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
      case "set_speed":
        this._setSpeed(command.speed);
        break;
      case "reset":
        this._reset();
        break;
    }
  }

  /**
   * Returns the current session state, or null if no session is loaded.
   * @returns ReplaySession or null
   */
  getSession(): ReplaySession | null {
    return this.session ? { ...this.session } : null;
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
    if (this.session.status === "playing") {
      this._scheduleNext();
    }
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
    this.eventBus.publish(event);
    this.session.cursor++;

    if (this.session.cursor >= this.session.totalEvents) {
      this.session.status = "completed";
    }
  }

  private _clearTimer(): void {
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
  }
}
