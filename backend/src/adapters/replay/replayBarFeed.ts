/**
 * adapters/replay/replayBarFeed.ts
 *
 * Market data for a sim runtime that has no Alpaca data keys: replays cached
 * 1-minute bars through the same BAR_RECEIVED path a live feed uses, so the
 * strategy, risk, simulated execution, and persistence run exactly as live.
 *
 * Bars are re-stamped with the moment they are published. A replay has no
 * quote stream, so the bar is the freshest price the risk engine sees; stamping
 * it "now" keeps the stale-quote check meaningful instead of rejecting every
 * order. At REPLAY_SPEED > 1 the wall-clock gaps between bars shrink, so
 * strategies that reason about bar spacing see compressed time.
 *
 * Bars come from the local bar cache only (seed it with `npm run data:pull`).
 * Nothing here calls Alpaca.
 */

import { logger } from "../../utils/logger";
import { newId } from "../../utils/ids";
import { nowMs, msToIso } from "../../utils/time";
import type { EventBus } from "../../core/engine/eventBus";
import type { Bar } from "../../types/market";
import type { ExecutionMode, Symbol } from "../../types/common";

const BAR_MS = 60_000;
/** A gap longer than this is a session break (overnight, weekend) and is skipped. */
const SESSION_BREAK_MS = 30 * 60_000;

export interface ReplayBarSource {
  readBars(symbol: string, timeframe: string, startMs: number, endMs: number): Promise<Bar[]>;
}

export interface ReplayWindow {
  fromMs: number;
  toMs: number;
  speed: number;
}

export interface ReplayTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

const realTimers: ReplayTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: nowMs,
};

export class ReplayBarFeed {
  private readonly subscribed = new Set<Symbol>();
  /** Bars still to publish, grouped by their original period start. */
  private schedule = new Map<number, Bar[]>();
  private keys: number[] = [];
  private cursor = 0;
  private handle: unknown = null;
  private running = false;
  /** Original period start the replay resumes from; advances past each published minute. */
  private resumeFrom: number;

  constructor(
    private readonly eventBus: EventBus,
    private readonly mode: ExecutionMode,
    private readonly source: ReplayBarSource,
    private readonly window: ReplayWindow,
    private readonly timers: ReplayTimers = realTimers,
  ) {
    if (!(window.speed > 0)) throw new Error("REPLAY_SPEED must be > 0");
    this.resumeFrom = window.fromMs;
  }

  subscribe(symbols: Symbol[]): void {
    const fresh = symbols.filter((s) => !this.subscribed.has(s));
    fresh.forEach((s) => this.subscribed.add(s));
    if (this.running && fresh.length > 0) void this._load(fresh);
  }

  unsubscribe(symbols: Symbol[]): void {
    symbols.forEach((s) => this.subscribed.delete(s));
  }

  async connect(): Promise<void> {
    this.running = true;
    await this._load([...this.subscribed]);
    logger.info("ReplayBarFeed: replaying cached bars", {
      from: msToIso(this.window.fromMs), to: msToIso(this.window.toMs),
      speed: this.window.speed, symbols: [...this.subscribed], minutes: this.keys.length,
    });
    this._scheduleNext(0);
  }

  disconnect(): void {
    this.running = false;
    if (this.handle !== null) this.timers.clearTimeout(this.handle);
    this.handle = null;
  }

  /** Original period start of the next bar group, or null when the replay is done. */
  get position(): number | null {
    return this.cursor < this.keys.length ? this.keys[this.cursor] : null;
  }

  private async _load(symbols: Symbol[]): Promise<void> {
    // Symbols added mid-replay join from the current position, not the start.
    const from = this.resumeFrom;
    for (const symbol of symbols) {
      let bars: Bar[];
      try {
        bars = await this.source.readBars(symbol, "1Min", from, this.window.toMs);
      } catch (err) {
        logger.error("ReplayBarFeed: could not read cached bars", { symbol, err: String(err) });
        continue;
      }
      if (bars.length === 0) {
        logger.warn("ReplayBarFeed: no cached bars for symbol in the replay window — run `npm run data:pull`", { symbol });
      }
      for (const bar of bars) {
        const group = this.schedule.get(bar.ts) ?? [];
        group.push(bar);
        this.schedule.set(bar.ts, group);
      }
    }
    // The schedule holds only unpublished minutes, so it is the whole queue.
    this.keys = [...this.schedule.keys()].filter((k) => k >= this.resumeFrom).sort((a, b) => a - b);
    this.cursor = 0;
  }

  private _scheduleNext(delayMs: number): void {
    if (!this.running) return;
    if (this.cursor >= this.keys.length) {
      logger.info("ReplayBarFeed: replay finished");
      return;
    }
    this.handle = this.timers.setTimeout(() => this._publishNext(), delayMs);
  }

  private _publishNext(): void {
    this.handle = null;
    if (!this.running) return;
    const key = this.keys[this.cursor++];
    const group = this.schedule.get(key) ?? [];
    this.schedule.delete(key);
    this.resumeFrom = key + 1;
    const now = this.timers.now();
    for (const bar of group) {
      if (!this.subscribed.has(bar.symbol)) continue;
      const ts = now;
      this.eventBus.publish({
        id: newId(),
        type: "BAR_RECEIVED",
        ts: now,
        mode: this.mode,
        payload: { ...bar, ts, isoTs: msToIso(ts), timeframe: "1m" },
      });
    }
    const next = this.keys[this.cursor];
    const gap = next === undefined ? 0 : next - key;
    this._scheduleNext(Math.max(0, (gap > SESSION_BREAK_MS ? BAR_MS : gap) / this.window.speed));
  }
}
