/**
 * adapters/alpaca/marketData.ts
 *
 * Alpaca real-time market data WebSocket adapter. Connects to the Alpaca
 * data stream, subscribes to symbols, and emits normalized internal events
 * onto the EventBus. The core engine never sees raw Alpaca message shapes.
 *
 * Latency instrumentation is optional (options.probe / options.observers).
 * Without it the adapter does what it always did; with it, each frame is
 * stamped (wall + monotonic) at the first line of the message callback, every
 * event in a batch keeps that one receipt time, and parse / normalize /
 * dispatch spans are reported. A frame's identity is (connection epoch, frame
 * sequence); events add their index within the frame.
 *
 * Inputs:  List of symbols to subscribe to, EventBus instance.
 * Outputs: QuoteReceivedEvent, TradeReceivedEvent, BarReceivedEvent published
 *          to the EventBus on each incoming message.
 */

import WebSocket from "ws";
import { env } from "../../config/env";
import {
  normalizeQuote,
  normalizeTrade,
  normalizeBar,
  validateRawQuote,
  validateRawTrade,
  validateRawBar,
} from "./normalizer";
import { logger } from "../../utils/logger";
import { nowMs } from "../../utils/time";
import { newEventId } from "../../utils/ids";
import type { EventBus } from "../../core/engine/eventBus";
import type { Symbol, ExecutionMode } from "../../types/common";
import type { MarketDataIssue } from "../../types/market";
import type { EventTrace, TradingEvent } from "../../types/events";
import type {
  InboundFrame,
  MarketDataObserver,
  MarketDataProbe,
  MarketEventKind,
  StreamLifecycleKind,
} from "../../core/telemetry/latencyProbe";

/**
 * Ping cadence. A socket that has not answered the previous ping by the next
 * one is presumed half-open and torn down, so a dead feed reconnects instead
 * of silently starving every strategy of bars.
 */
const HEARTBEAT_INTERVAL_MS = 30_000;

export interface MarketDataAdapterOptions {
  /** Stream URL. Defaults to ALPACA_DATA_STREAM_URL. */
  url?: string;
  /** Latency probe; absent in ordinary runtimes. */
  probe?: MarketDataProbe;
  /** Passive observers (e.g. a frame recorder). Inbound frames only — never the auth frame. */
  observers?: MarketDataObserver[];
  /**
   * What happens to a quote/trade/bar that fails validation. "pass" (the class
   * default) publishes it unchanged; "quarantine" drops "reject"-severity
   * messages — one-sided or crossed quotes, non-positive prices, unparseable
   * timestamps — before they reach state, marks or strategies. Trading
   * runtimes quarantine by default (MARKET_DATA_INVALID_POLICY).
   */
  invalidData?: "pass" | "quarantine";
}

export class AlpacaMarketDataAdapter {
  private ws: WebSocket | null = null;
  private subscribed: Set<Symbol> = new Set();
  private isConnected = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private alive = false;
  /** Increments on every connect so frames from different sockets stay distinguishable. */
  private connectionEpoch = 0;
  /** Process-wide inbound frame sequence. */
  private frameSeq = 0;
  /** Set only while ingestFrame() replays a frame: its recorded receive wall time. */
  private replayWallMs: number | null = null;
  private readonly probe?: MarketDataProbe;
  private readonly observers: MarketDataObserver[];
  private readonly quarantine: boolean;
  /** Messages dropped by quarantine, by "<kind>.<issue code>". */
  private readonly quarantined = new Map<string, number>();
  private readonly url?: string;

  constructor(
    private readonly eventBus: EventBus,
    private readonly mode: ExecutionMode = "paper",
    options: MarketDataAdapterOptions = {},
  ) {
    this.probe = options.probe;
    this.observers = [...(options.probe ? [options.probe] : []), ...(options.observers ?? [])];
    this.quarantine = options.invalidData === "quarantine";
    this.url = options.url;
  }

  /**
   * Opens the WebSocket connection to the Alpaca data stream and authenticates.
   * @returns Promise that resolves when the connection is authenticated
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.url ?? env.alpacaDataStreamUrl;
      this.connectionEpoch++;
      logger.info("AlpacaMarketDataAdapter: connecting", { url, mode: this.mode });
      this._lifecycle("connecting", { url });
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.on("open", () => {
        logger.info("AlpacaMarketDataAdapter: WebSocket open — authenticating");
        this._lifecycle("open");
        ws.send(JSON.stringify({
          action: "auth",
          key: env.alpacaDataKey,
          secret: env.alpacaDataSecret,
        }));
      });

      ws.on("message", (data: WebSocket.Data) => {
        this._handleMessage(data, resolve, reject);
      });

      ws.on("pong", () => {
        this.alive = true;
      });

      ws.on("error", (err) => {
        logger.error("AlpacaMarketDataAdapter: WebSocket error", { message: err.message });
        this._lifecycle("stream_error", { message: err.message });
        reject(err);
      });

      ws.on("close", () => {
        // A replaced socket, or one closed by disconnect(), stays closed.
        if (this.ws !== ws) return;
        logger.warn("AlpacaMarketDataAdapter: WebSocket closed — scheduling reconnect");
        this._lifecycle("closed");
        this.isConnected = false;
        this._stopHeartbeat();
        this._scheduleReconnect();
      });
    });
  }

  /**
   * Subscribes to real-time quotes, trades, and bars for the given symbols.
   * Sends the Alpaca subscription message over the active WebSocket.
   * @param symbols - Array of ticker symbols to subscribe to
   */
  subscribe(symbols: Symbol[]): void {
    // Always retain the desired set. Boot-time run adoption happens before the
    // socket is authenticated; dropping those symbols here leaves an adopted
    // strategy visibly running but permanently starved of market data.
    symbols.forEach((s) => this.subscribed.add(s));
    if (!this.isConnected || !this.ws) {
      logger.info("AlpacaMarketDataAdapter: subscription queued until connected", { symbols });
      return;
    }
    this.ws.send(JSON.stringify({
      action: "subscribe",
      quotes: symbols,
      trades: symbols,
      bars: symbols,
    }));
    this._lifecycle("subscribe_sent", { symbols });
    logger.info("AlpacaMarketDataAdapter: subscribed", { symbols });
  }

  /**
   * Unsubscribes from data updates for the given symbols.
   * @param symbols - Array of ticker symbols to unsubscribe from
   */
  unsubscribe(symbols: Symbol[]): void {
    if (!this.ws) return;
    symbols.forEach((s) => this.subscribed.delete(s));
    this.ws.send(JSON.stringify({
      action: "unsubscribe",
      quotes: symbols,
      trades: symbols,
      bars: symbols,
    }));
    logger.info("AlpacaMarketDataAdapter: unsubscribed", { symbols });
  }

  /**
   * Disconnects the WebSocket and stops any pending reconnect.
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this._stopHeartbeat();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.isConnected = false;
    this._lifecycle("disconnect_requested");
    logger.info("AlpacaMarketDataAdapter: disconnected");
  }

  /** Messages dropped by the quarantine policy so far, by "<kind>.<issue code>". */
  quarantineCounts(): Record<string, number> {
    return Object.fromEntries(this.quarantined);
  }

  /**
   * Processes one inbound frame exactly as the socket callback would, without
   * a socket. Used by the benchmark's recorded and synthetic replay so the
   * measured path is the production parse → normalize → publish path.
   * @param data - Raw frame text or buffer
   * @param epoch - Connection epoch to attribute the frame to (replay keeps the recorded one)
   * @param seq - Recorded frame sequence, so replay trace ids match the recording
   * @param recordedRxWallMs - Recorded receive wall time. Event ages are a property
   *   of the recording, so replay reports them from this, while durations still
   *   use this process's monotonic clock.
   */
  ingestFrame(data: WebSocket.Data, epoch?: number, seq?: number, recordedRxWallMs?: number): void {
    if (epoch !== undefined) this.connectionEpoch = epoch;
    if (seq !== undefined) this.frameSeq = seq - 1;
    this.replayWallMs = recordedRxWallMs ?? null;
    try {
      this._handleMessage(data);
    } finally {
      this.replayWallMs = null;
    }
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  private _handleMessage(
    data: WebSocket.Data,
    authResolve?: (v: void) => void,
    authReject?: (err: Error) => void,
  ): void {
    // Receipt is stamped before anything else, including decoding.
    const observed = this.observers.length > 0;
    const rxMonoNs = observed ? process.hrtime.bigint() : 0n;
    const rxWallMs = observed ? (this.replayWallMs ?? Date.now()) : 0;
    const text = data.toString();
    let frame: InboundFrame | null = null;
    if (observed) {
      frame = { epoch: this.connectionEpoch, seq: ++this.frameSeq, rxWallMs, rxMonoNs, text };
      for (const o of this.observers) o.onFrame?.(frame);
    }

    let messages: unknown[];
    try {
      messages = JSON.parse(text);
      if (!Array.isArray(messages)) throw new Error("frame is not an array");
    } catch {
      if (frame) this.probe?.frameParsed(frame, 0, process.hrtime.bigint(), false);
      logger.warn("AlpacaMarketDataAdapter: failed to parse message");
      return;
    }
    let frameTrace: EventTrace | undefined;
    if (frame && this.probe) {
      this.probe.frameParsed(frame, messages.length, process.hrtime.bigint(), true);
      frameTrace = this.probe.frameTrace(frame);
    }

    for (let index = 0; index < messages.length; index++) {
      const m = (messages[index] ?? {}) as Record<string, unknown>;
      const msgType = m["T"] as string | undefined;

      switch (msgType) {
        case "connected":
          logger.debug("AlpacaMarketDataAdapter: received connected");
          break;

        case "success":
          if (m["msg"] === "authenticated") {
            this.isConnected = true;
            this._startHeartbeat();
            logger.info("AlpacaMarketDataAdapter: authenticated");
            this._lifecycle("authenticated");
            if (this.subscribed.size > 0) {
              const symbols = [...this.subscribed];
              this.ws!.send(JSON.stringify({
                action: "subscribe",
                quotes: symbols,
                trades: symbols,
                bars: symbols,
              }));
              this._lifecycle("subscribe_sent", { symbols, restored: true });
              logger.info("AlpacaMarketDataAdapter: restored subscriptions", { symbols });
            }
            authResolve?.();
          }
          break;

        case "subscription":
          // The server's view of what we are subscribed to — not the desired set.
          this._lifecycle("subscription_ack", {
            trades: m["trades"], quotes: m["quotes"], bars: m["bars"],
            updatedBars: m["updatedBars"], dailyBars: m["dailyBars"],
            corrections: m["corrections"], cancelErrors: m["cancelErrors"],
          });
          break;

        case "error":
          logger.error("AlpacaMarketDataAdapter: auth error", m);
          this._lifecycle("auth_error", { code: m["code"], msg: m["msg"] });
          authReject?.(new Error(String(m["msg"] ?? "Unknown auth error")));
          break;

        case "q":
          // Ordinary runtimes take the first branch: exactly the original publish.
          if (!this.probe && !this.quarantine) {
            this.eventBus.publish({ id: newEventId(), type: "QUOTE_RECEIVED", ts: nowMs(), mode: this.mode, payload: normalizeQuote(m as never) });
          } else {
            this._publishObserved(frame, frameTrace, index, "quote", m, validateRawQuote, () => ({
              id: newEventId(), type: "QUOTE_RECEIVED", ts: nowMs(), mode: this.mode, payload: normalizeQuote(m as never),
            }));
          }
          break;

        case "t":
          if (!this.probe && !this.quarantine) {
            this.eventBus.publish({ id: newEventId(), type: "TRADE_RECEIVED", ts: nowMs(), mode: this.mode, payload: normalizeTrade(m as never) });
          } else {
            this._publishObserved(frame, frameTrace, index, "trade", m, validateRawTrade, () => ({
              id: newEventId(), type: "TRADE_RECEIVED", ts: nowMs(), mode: this.mode, payload: normalizeTrade(m as never),
            }));
          }
          break;

        case "b":
          if (!this.probe && !this.quarantine) {
            this.eventBus.publish({ id: newEventId(), type: "BAR_RECEIVED", ts: nowMs(), mode: this.mode, payload: normalizeBar(m as never, "1m") });
          } else {
            this._publishObserved(frame, frameTrace, index, "bar", m, validateRawBar, () => ({
              id: newEventId(), type: "BAR_RECEIVED", ts: nowMs(), mode: this.mode, payload: normalizeBar(m as never, "1m"),
            }));
          }
          break;

        default:
          if (frame) this.probe?.unhandledMessage(String(msgType ?? ""));
          logger.debug("AlpacaMarketDataAdapter: unhandled message type", { type: msgType });
      }
    }
    if (frame && this.probe) this.probe.frameDone(frame, process.hrtime.bigint());
  }

  /**
   * The instrumented / quarantining path: validates, optionally drops, times
   * normalization and dispatch, and stamps the trace id on the event.
   */
  private _publishObserved(
    frame: InboundFrame | null,
    frameTrace: EventTrace | undefined,
    index: number,
    kind: MarketEventKind,
    raw: Record<string, unknown>,
    validate: (raw: Record<string, unknown>) => MarketDataIssue | null,
    build: () => TradingEvent,
  ): void {
    const probe = frame ? this.probe : undefined;
    if (probe && frame && !probe.stageDetail) {
      // Frame detail: count and age the event without reading the clock.
      const issue = validate(raw);
      const quarantined = this._shouldDrop(kind, raw, issue);
      probe.marketEventLite(frame, kind, typeof raw["t"] === "string" ? raw["t"] : "", issue, quarantined);
      if (quarantined) return;
      const event = build();
      event.trace = frameTrace;
      this.eventBus.publish(event);
      return;
    }
    const normStartNs = probe ? probe.now() : 0n;
    const issue = validate(raw);
    const quarantined = this._shouldDrop(kind, raw, issue);
    const event = quarantined ? null : build();
    if (!probe || !frame) {
      if (event) this.eventBus.publish(event);
      return;
    }

    const traceId = probe.marketEvent({
      frame, index, kind,
      symbol: typeof raw["S"] === "string" ? raw["S"] : "",
      providerTs: typeof raw["t"] === "string" ? raw["t"] : "",
      normStartNs, normEndNs: probe.now(), issue, quarantined,
    });
    if (!event) return;
    event.trace = { id: traceId, rxMonoNs: Number(frame.rxMonoNs) };
    const dispatchStart = probe.now();
    this.eventBus.publish(event);
    probe.dispatched(traceId, dispatchStart, probe.now());
  }

  /**
   * True when the policy drops this message. Drops are counted, and logged at
   * the 1st, 10th, 100th, ... occurrence of each kind/code so a feed that
   * misbehaves all day stays visible without flooding the log.
   */
  private _shouldDrop(kind: MarketEventKind, raw: Record<string, unknown>, issue: MarketDataIssue | null): boolean {
    if (!this.quarantine || issue?.severity !== "reject") return false;
    const key = `${kind}.${issue.code}`;
    const n = (this.quarantined.get(key) ?? 0) + 1;
    this.quarantined.set(key, n);
    if (Number.isInteger(Math.log10(n))) {
      logger.warn("AlpacaMarketDataAdapter: dropped unusable market data", {
        kind, issue: issue.code, symbol: raw["S"], count: n,
      });
    }
    return true;
  }

  private _lifecycle(kind: StreamLifecycleKind, detail?: Record<string, unknown>): void {
    if (this.observers.length === 0) return;
    const event = { kind, epoch: this.connectionEpoch, wallMs: Date.now(), monoNs: process.hrtime.bigint(), detail };
    for (const o of this.observers) o.onLifecycle?.(event);
  }

  private _startHeartbeat(): void {
    this._stopHeartbeat();
    this.alive = true;
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws) return;
      if (!this.alive) {
        logger.warn("AlpacaMarketDataAdapter: missed a heartbeat — reconnecting");
        ws.terminate(); // emits close, which reconnects
        return;
      }
      this.alive = false;
      ws.ping();
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private _scheduleReconnect(): void {
    const RECONNECT_DELAY_MS = 5_000;
    if (this.reconnectTimeout) return;
    this._lifecycle("reconnect_scheduled", { delayMs: RECONNECT_DELAY_MS });
    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      logger.info("AlpacaMarketDataAdapter: reconnecting...");
      try {
        await this.connect();
      } catch (err) {
        logger.error("AlpacaMarketDataAdapter: reconnect failed", { err });
      }
    }, RECONNECT_DELAY_MS);
  }
}
