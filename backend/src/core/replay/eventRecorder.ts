/**
 * core/replay/eventRecorder.ts
 *
 * Records every TradingEvent published to an EventBus so a trading session can
 * be saved to event_logs and played back later by the replay runtime.
 *
 * The buffer is bounded: once maxEvents are held, each new event drops the
 * oldest, so a long session keeps its most recent stretch rather than growing
 * the process without limit. REPLAY_TICK is never recorded — it describes a
 * playback, not the market.
 *
 * Inputs:  EventBus events between start() and stop().
 * Outputs: The recorded events (oldest first) and how many were dropped.
 */

import type { EventBus } from "../engine/eventBus";
import type { TradingEvent } from "../../types/events";
import type { EventLogRecord } from "../../types/replay";
import type { UUID } from "../../types/common";

export interface Recording {
  events: TradingEvent[];
  /** Events evicted because the buffer was full. */
  dropped: number;
}

export class EventRecorder {
  private buffer: TradingEvent[] = [];
  /** Index of the oldest event once the buffer has wrapped. */
  private head = 0;
  private dropped = 0;
  private recording = false;

  private readonly handler = (event: TradingEvent): void => {
    if (event.type === "REPLAY_TICK") return;
    if (this.buffer.length < this.maxEvents) {
      this.buffer.push(event);
      return;
    }
    this.buffer[this.head] = event;
    this.head = (this.head + 1) % this.maxEvents;
    this.dropped++;
  };

  constructor(
    private readonly eventBus: EventBus,
    private readonly maxEvents: number,
  ) {
    if (!Number.isInteger(maxEvents) || maxEvents < 1) {
      throw new Error(`EventRecorder: maxEvents must be a positive integer, got ${maxEvents}`);
    }
  }

  /** Clears any earlier recording and subscribes to the bus. */
  start(): void {
    if (this.recording) return;
    this.buffer = [];
    this.head = 0;
    this.dropped = 0;
    this.recording = true;
    this.eventBus.onAll(this.handler);
  }

  /** Unsubscribes and returns what was recorded, oldest first. */
  stop(): Recording {
    if (this.recording) {
      this.recording = false;
      this.eventBus.offAll(this.handler);
    }
    const events = this.head === 0
      ? [...this.buffer]
      : [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)];
    return { events, dropped: this.dropped };
  }

  get isRecording(): boolean {
    return this.recording;
  }
}

/**
 * The event_logs metadata for a recording: the period covered comes from the
 * first and last event, so it reflects what was kept, not when the process ran.
 */
export function eventLogFor(
  id: UUID,
  source: string,
  recording: Recording,
): Omit<EventLogRecord, "createdAt"> {
  const { events, dropped } = recording;
  const start = new Date(events[0]?.ts ?? Date.now()).toISOString();
  const end = new Date(events[events.length - 1]?.ts ?? Date.now()).toISOString();
  return {
    id,
    name: `${source} session ${start}`,
    description: dropped > 0
      ? `Oldest ${dropped} events dropped by the recording cap`
      : undefined,
    source,
    eventCount: events.length,
    startDate: start,
    endDate: end,
  };
}
