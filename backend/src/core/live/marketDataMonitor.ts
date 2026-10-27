/**
 * core/live/marketDataMonitor.ts
 *
 * What market data a trading runtime is actually receiving: the source, the
 * Alpaca feed, whether the stream is up, and when the last bar arrived. Served
 * on /api/system/status for the frontend's data badge, and stamped on every
 * run at start so its results say what data they were traded on.
 *
 * Observes only: bar arrivals come off the event bus, connection state from the
 * adapter's own flag, so the stream's hot path is untouched.
 */

import { nowMs } from "../../utils/time";
import type { EventBus } from "../engine/eventBus";
import type { MarketHours } from "../market/marketHours";

export type MarketDataSource = "alpaca-stream" | "none";

export type MarketDataState =
  /** No data keys: this runtime receives nothing. */
  | "no_data"
  /** Keys present, stream not connected (connecting or reconnecting). */
  | "disconnected"
  /** Connected; no running strategy has subscribed to a symbol yet. */
  | "idle"
  /** A bar arrived within STALE_AFTER_MS. */
  | "live"
  /** Subscribed in market hours, but no bar within STALE_AFTER_MS. */
  | "stale"
  /** Subscribed, no recent bar, and the market is closed. */
  | "market_closed";

export interface MarketDataStatus {
  source: MarketDataSource;
  feed: string | null;
  state: MarketDataState;
  connected: boolean;
  subscribedSymbols: number;
  lastBarAt: number | null;
  staleAfterMs: number;
  message: string;
}

/** What a run records about the data it traded on. */
export interface RunMarketData {
  source: MarketDataSource;
  feed: string | null;
}

/** Bars arrive once a minute per active symbol; three quiet minutes means something is wrong. */
export const STALE_AFTER_MS = 3 * 60_000;

/** The feed an Alpaca stream URL selects: its last path segment (iex, sip, test). */
export function feedFromStreamUrl(url: string): string {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).pop() ?? "unknown";
  } catch {
    return "unknown";
  }
}

export interface MarketDataMonitorDeps {
  source: MarketDataSource;
  feed: string | null;
  isConnected: () => boolean;
  /** The hours the risk engine trades by, so "market closed" matches what it enforces. */
  marketHours: MarketHours;
  now?: () => number;
}

export class MarketDataMonitor {
  private lastBarAt: number | null = null;
  private readonly symbols = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly deps: MarketDataMonitorDeps) {
    this.now = deps.now ?? nowMs;
  }

  attach(eventBus: Pick<EventBus, "on">): void {
    eventBus.on("BAR_RECEIVED", () => { this.lastBarAt = this.now(); });
  }

  noteSubscribed(symbols: readonly string[]): void {
    for (const s of symbols) this.symbols.add(s);
  }

  runStamp(): RunMarketData {
    return this.deps.source === "none"
      ? { source: "none", feed: null }
      : { source: this.deps.source, feed: this.deps.feed };
  }

  status(): MarketDataStatus {
    const { source } = this.deps;
    const feed = source === "none" ? null : this.deps.feed;
    const connected = source !== "none" && this.deps.isConnected();
    const now = this.now();
    const fresh = this.lastBarAt !== null && now - this.lastBarAt <= STALE_AFTER_MS;
    const feedLabel = (feed ?? "").toUpperCase();

    let state: MarketDataState;
    let message: string;
    if (source === "none") {
      state = "no_data";
      message = "No market data: this runner has no Alpaca data keys. Add your own Alpaca paper keys " +
        "to backend/.env and restart the stack.";
    } else if (!connected) {
      state = "disconnected";
      message = "The Alpaca data stream is not connected; it reconnects automatically.";
    } else if (this.symbols.size === 0) {
      state = "idle";
      message = `Connected to Alpaca (${feedLabel}). No running strategy has subscribed to a symbol yet.`;
    } else if (fresh) {
      state = "live";
      message = `Live bars from Alpaca (${feedLabel}).`;
    } else if (!this.deps.marketHours.isOpen(now)) {
      state = "market_closed";
      message = "The market is closed; bars resume at the next session.";
    } else {
      state = "stale";
      message = `No bar received in the last ${STALE_AFTER_MS / 60_000} minutes during market hours.`;
    }

    return {
      source, feed, state, connected,
      subscribedSymbols: this.symbols.size,
      lastBarAt: this.lastBarAt,
      staleAfterMs: STALE_AFTER_MS,
      message,
    };
  }
}
