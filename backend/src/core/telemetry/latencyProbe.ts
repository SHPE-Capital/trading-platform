/**
 * core/telemetry/latencyProbe.ts
 *
 * Optional latency instrumentation for the market-data → strategy → risk →
 * journal → broker path. Nothing constructs a probe in an ordinary runtime;
 * components that accept one do no extra work without it.
 *
 * What it keeps, all bounded:
 *   - One fixed-size histogram per stage and event kind, for EVERY event
 *     (not sampled), so percentiles have their true denominators.
 *   - Counters: events, frames, issues, outcomes, deadline misses, drops.
 *   - A reservoir of detailed traces for a sampled fraction of events.
 *   - Recent connection lifecycle records.
 *
 * Correlation is by immutable ids: a market event gets a trace id stamped at
 * frame receipt; the orchestrator copies it onto signals and intents; from the
 * intent on, the order path is keyed by intent id (= order id). Nested
 * synchronous spans (evaluate inside dispatch) overlap their parent and are
 * reported as separate distributions, never summed.
 *
 * Inputs:  Hook calls from the adapter, orchestrator and order-path decorators.
 * Outputs: snapshot() for metrics.json, traceSamples() for trace-sample.ndjson.
 */

import { Histogram, type HistogramJSON } from "./histogram";
import { BOOT_ID, CLOCK_DOMAIN_ID, monoNs, parseRfc3339Parts, parseRfc3339ToEpochNs, rfc3339ToEpochMs, wallMs } from "./clock";
import type { EventTrace } from "../../types/events";
import type { MarketDataIssue } from "../../types/market";

export const PROBE_SCHEMA_VERSION = 1;

export type MarketEventKind = "quote" | "trade" | "bar";

/** One inbound WebSocket frame, stamped at the first line of the message callback. */
export interface InboundFrame {
  /** Connection epoch: increments on every connect, so reconnects are visible. */
  epoch: number;
  /** Process-wide frame sequence, monotonically increasing across epochs. */
  seq: number;
  rxWallMs: number;
  rxMonoNs: bigint;
  /** Decoded frame text (inbound only — outbound auth frames are never observed). */
  text: string;
}

export type StreamLifecycleKind =
  | "connecting"
  | "open"
  | "authenticated"
  | "auth_error"
  | "stream_error"
  | "closed"
  | "subscribe_sent"
  | "subscription_ack"
  | "reconnect_scheduled"
  | "disconnect_requested";

export interface StreamLifecycleEvent {
  kind: StreamLifecycleKind;
  epoch: number;
  wallMs: number;
  monoNs: bigint;
  detail?: Record<string, unknown>;
}

/** Passive observer of the market-data stream (recorder, probe). */
export interface MarketDataObserver {
  onFrame?(frame: InboundFrame): void;
  onLifecycle?(event: StreamLifecycleEvent): void;
}

export interface MarketEventObservation {
  frame: InboundFrame;
  index: number;
  kind: MarketEventKind;
  symbol: string;
  /** Provider timestamp exactly as received. */
  providerTs: string;
  normStartNs: bigint;
  normEndNs: bigint;
  issue: MarketDataIssue | null;
  quarantined: boolean;
}

/** What the market-data adapter reports. */
export interface MarketDataProbe extends MarketDataObserver {
  /** True at "stage" detail: per-event normalize/dispatch spans (diagnostic, costly). */
  readonly stageDetail: boolean;
  now(): bigint;
  frameParsed(frame: InboundFrame, messageCount: number, parseEndNs: bigint, ok: boolean): void;
  /** The trace shared by every event of a frame (frame detail). */
  frameTrace(frame: InboundFrame): EventTrace;
  /** Frame detail: counts, issues and event age for one event — no clock reads. */
  marketEventLite(frame: InboundFrame, kind: MarketEventKind, providerTs: string, issue: MarketDataIssue | null, quarantined: boolean): void;
  /** Stage detail: returns the per-event trace id the adapter stamps on the published event. */
  marketEvent(obs: MarketEventObservation): string;
  dispatched(traceId: string, startNs: bigint, endNs: bigint): void;
  /** All of a frame's events have been dispatched. */
  frameDone(frame: InboundFrame, endNs: bigint): void;
  unhandledMessage(type: string): void;
  /** A correction of data already delivered (updated bar, trade correction/cancel). */
  revision(kind: string): void;
}

export type EngineStage = "state" | "evaluate" | "risk";

/** What the orchestrator reports. */
export interface EngineProbe {
  /** State and evaluate spans are taken only at "stage" detail; risk/intent always. */
  readonly stageDetail: boolean;
  now(): bigint;
  /** A completed engine stage. `intentId` ties a risk span to the intent it decided. */
  span(
    trace: EventTrace | undefined,
    stage: EngineStage,
    startNs: bigint,
    endNs: bigint,
    outcome?: string,
    intentId?: string,
  ): void;
  intentReady(intentId: string, trace: EventTrace | undefined, ns: bigint): void;
}

export type OrderUpdateKind = "submitted" | "partial_fill" | "filled" | "canceled" | "rejected" | "expired" | "broker_ack";

/** What the order-path decorators and lifecycle listeners report. */
export interface OrderPathProbe {
  now(): bigint;
  journal(intentId: string, startNs: bigint, endNs: bigint, outcome: string): void;
  submitStart(intentId: string, ns: bigint): void;
  submitEnd(intentId: string, ns: bigint, outcome: string): void;
  /** HTTP response headers for a submission arrived (body not yet read). */
  responseHeaders(intentId: string, ns: bigint): void;
  orderUpdate(orderId: string, kind: OrderUpdateKind, ns: bigint): void;
  fillApplied(orderId: string, ns: bigint, terminal: boolean): void;
}

export interface LatencyProbeOptions {
  runId: string;
  /**
   * "frame" (default): one receipt and one completion stamp per frame, per-event
   * counts and ages, and the order path. "stage": also per-event normalize /
   * dispatch / state / evaluate spans — several clock reads per event, so use it
   * to diagnose, not to measure overall throughput.
   */
  detail?: "frame" | "stage";
  /** Fraction of events whose full span detail is retained. Histograms see every event. */
  sampleProbability?: number;
  /** Reservoir size for detailed traces. */
  maxTraceSamples?: number;
  /** Bound on in-flight market-event traces (a missed dispatched() call is evicted, counted). */
  maxOpenTraces?: number;
  /** Bound on in-flight intent traces. */
  maxOpenIntents?: number;
  /** Deadlines per metric name, in milliseconds. A value above it counts a deadline miss. */
  deadlinesMs?: Record<string, number>;
  normalizationVersion?: string;
  /** Injectable for deterministic sampling in tests. */
  random?: () => number;
  /** Injectable monotonic clock for tests. */
  clock?: () => bigint;
}

interface Span {
  stage: string;
  startNs: bigint;
  endNs: bigint;
  outcome?: string;
}

interface OpenTrace {
  id: string;
  kind: MarketEventKind;
  symbol: string;
  frame: InboundFrame;
  index: number;
  providerTs: string;
  sampled: boolean;
  spans: Span[];
  issue: MarketDataIssue | null;
  quarantined: boolean;
}

interface IntentTrace {
  intentId: string;
  traceId: string | null;
  kind: MarketEventKind | "untraced";
  rxMonoNs: number | null;
  sampled: boolean;
  spans: Span[];
  submitStartNs: bigint | null;
  firstUpdateSeen: boolean;
}

export interface TraceRecord {
  schema_version: number;
  record: "market_event" | "intent" | "frame";
  run_id: string;
  clock_domain_id: string;
  [key: string]: unknown;
}

export interface LifecycleRecord {
  kind: StreamLifecycleKind;
  epoch: number;
  wall_ms: number;
  mono_ns: string;
  detail?: Record<string, unknown>;
}

export interface ProbeSnapshot {
  schema_version: number;
  run_id: string;
  clock_domain_id: string;
  boot_id: string;
  process_id: number;
  normalization_version: string | null;
  started_wall_ms: number;
  captured_wall_ms: number;
  elapsed_ns: string;
  sampling: {
    probability: number;
    traces_total: number;
    traces_sampled: number;
    traces_retained: number;
    open_trace_evictions: number;
    intent_evictions: number;
    detail: "frame" | "stage";
    frames_total: number;
  };
  counters: Record<string, number>;
  deadlines_ms: Record<string, number>;
  histograms: Record<string, HistogramJSON>;
  lifecycle: LifecycleRecord[];
  last_subscription_ack: Record<string, unknown> | null;
}

/** Human-readable percentile summary in milliseconds. */
export interface LatencySummary {
  count: number;
  p50_ms: number | null;
  p90_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  max_ms: number | null;
}

export function summarizeHistogram(h: Histogram): LatencySummary {
  const ms = (v: number | null): number | null => (v === null ? null : v / 1e6);
  return {
    count: h.count,
    p50_ms: ms(h.percentile(0.5)),
    p90_ms: ms(h.percentile(0.9)),
    p95_ms: ms(h.percentile(0.95)),
    p99_ms: ms(h.percentile(0.99)),
    max_ms: ms(h.max),
  };
}

const MAX_LIFECYCLE_RECORDS = 1_000;
const BAR_INTERVAL_MS = 60_000;

/** Bigint → decimal string for JSON. */
const s = (v: bigint | null | undefined): string | null => (v === null || v === undefined ? null : v.toString());

function spanJson(sp: Span): Record<string, unknown> {
  return { stage: sp.stage, start_ns: s(sp.startNs), end_ns: s(sp.endNs), ...(sp.outcome ? { outcome: sp.outcome } : {}) };
}

/** A named histogram with an optional deadline; hot paths hold these directly. */
class Metric {
  misses = 0;
  constructor(readonly name: string, readonly hist: Histogram, readonly deadlineNs: number | undefined) {}

  add(v: number): void {
    this.hist.record(v);
    if (this.deadlineNs !== undefined && v > this.deadlineNs) this.misses++;
  }
}

class Counter {
  value = 0;
}

/** Pre-resolved metrics for one event kind, so the per-event path builds no strings. */
interface KindHandles {
  events: Counter;
  quarantined: Counter;
  unparseable: Counter;
  ageNegCount: Counter;
  queue: Metric;
  normalize: Metric;
  dispatch: Metric;
  receiveToDispatchEnd: Metric;
  age: Metric;
  ageNeg: Metric;
  state: Metric;
  risk: Metric;
}

type HandleKind = MarketEventKind | "untraced";

export class LatencyProbe implements MarketDataProbe, EngineProbe, OrderPathProbe {
  readonly runId: string;
  readonly stageDetail: boolean;
  private readonly sampleProbability: number;
  private readonly maxTraceSamples: number;
  private readonly maxOpenTraces: number;
  private readonly maxOpenIntents: number;
  private readonly random: () => number;
  private readonly clock: () => bigint;
  private readonly normalizationVersion: string | null;
  private readonly deadlinesMs: Record<string, number>;

  private readonly metrics = new Map<string, Metric>();
  private readonly counters = new Map<string, Counter>();
  private readonly byKind: Record<HandleKind, KindHandles>;
  private readonly hFrameParse: Metric;
  private readonly hFrameMessages: Metric;
  private readonly hFrameChars: Metric;
  private readonly hInterarrival: Metric;
  private readonly hEvaluate: Metric;
  private readonly hReceiveToIntent: Metric;
  private readonly hJournal: Metric;
  private readonly hReceiveToSubmit: Metric;
  private readonly hSubmitToResponse: Metric;
  private readonly hSubmitToFirstUpdate: Metric;
  private readonly hReceiveToFill: Metric;
  private readonly hBarLag: Metric;
  private readonly hFrameDone: Metric;
  private readonly hBarLagNeg: Metric;
  private readonly cFrames: Counter;
  private readonly cBarLagNeg: Counter;
  private readonly cEvalSignal: Counter;
  private readonly cEvalNoSignal: Counter;
  private readonly cEvalError: Counter;

  private readonly openTraces = new Map<string, OpenTrace>();
  private readonly openIntents = new Map<string, IntentTrace>();
  private readonly reservoir: TraceRecord[] = [];
  private readonly lifecycleRecords: LifecycleRecord[] = [];
  private lastFrameEpoch = -1;
  private lastFrameMono = 0n;
  /** Sampling decision for the frame being processed (frames are processed synchronously). */
  private frameSampled = false;
  private framesTotal = 0;
  private lastSubscriptionAck: Record<string, unknown> | null = null;

  private tracesTotal = 0;
  private tracesSampled = 0;
  private sampledRecordsSeen = 0;
  private openTraceEvictions = 0;
  private intentEvictions = 0;

  private readonly startedWallMs = wallMs();
  private readonly startedMonoNs: bigint;

  constructor(options: LatencyProbeOptions) {
    this.runId = options.runId;
    this.stageDetail = options.detail === "stage";
    this.sampleProbability = Math.min(1, Math.max(0, options.sampleProbability ?? 0.01));
    this.maxTraceSamples = options.maxTraceSamples ?? 5_000;
    this.maxOpenTraces = options.maxOpenTraces ?? 20_000;
    this.maxOpenIntents = options.maxOpenIntents ?? 20_000;
    this.random = options.random ?? Math.random;
    this.clock = options.clock ?? monoNs;
    this.normalizationVersion = options.normalizationVersion ?? null;
    this.deadlinesMs = { ...(options.deadlinesMs ?? {}) };
    this.startedMonoNs = this.clock();

    const handles = (k: HandleKind): KindHandles => ({
      events: this.counterRef(`events.${k}`),
      quarantined: this.counterRef(`quarantined.${k}`),
      unparseable: this.counterRef(`events.${k}.unparseable_provider_ts`),
      ageNegCount: this.counterRef(`event.age_ns.${k}.negative_count`),
      queue: this.metric(`event.queue_in_frame_ns.${k}`),
      normalize: this.metric(`event.normalize_ns.${k}`),
      dispatch: this.metric(`event.dispatch_ns.${k}`),
      receiveToDispatchEnd: this.metric(`event.receive_to_dispatch_end_ns.${k}`),
      age: this.metric(`event.age_ns.${k}`),
      ageNeg: this.metric(`event.age_ns.${k}.negative`),
      state: this.metric(`engine.state_ns.${k}`),
      risk: this.metric(`engine.risk_ns.${k}`),
    });
    this.byKind = { quote: handles("quote"), trade: handles("trade"), bar: handles("bar"), untraced: handles("untraced") };
    this.hFrameParse = this.metric("frame.parse_ns");
    this.hFrameMessages = this.metric("frame.messages", "count");
    this.hFrameChars = this.metric("frame.chars", "chars");
    this.hInterarrival = this.metric("frame.interarrival_ns");
    this.hEvaluate = this.metric("engine.evaluate_ns");
    this.hReceiveToIntent = this.metric("order.receive_to_intent_ns");
    this.hJournal = this.metric("order.journal_ns");
    this.hReceiveToSubmit = this.metric("order.receive_to_submit_ns");
    this.hSubmitToResponse = this.metric("order.submit_to_response_ns");
    this.hSubmitToFirstUpdate = this.metric("order.submit_to_first_update_ns");
    this.hReceiveToFill = this.metric("order.receive_to_fill_applied_ns");
    this.hBarLag = this.metric("bar.publication_lag_ns");
    this.hFrameDone = this.metric("frame.receive_to_done_ns");
    this.hBarLagNeg = this.metric("bar.publication_lag_ns.negative");
    this.cFrames = this.counterRef("frames.received");
    this.cBarLagNeg = this.counterRef("bar.publication_lag_ns.negative_count");
    this.cEvalSignal = this.counterRef("evaluate.outcome.signal");
    this.cEvalNoSignal = this.counterRef("evaluate.outcome.no_signal");
    this.cEvalError = this.counterRef("evaluate.outcome.error");
  }

  now(): bigint {
    return this.clock();
  }

  // ------------------------------------------------------------------
  // Generic recording
  // ------------------------------------------------------------------

  /** Records a value into a named histogram, counting a deadline miss if one is set. */
  record(name: string, value: number | bigint, unit = "ns"): void {
    this.metric(name, unit).add(typeof value === "bigint" ? Number(value) : value);
  }

  /** Records a signed duration, routing negatives to `<name>.negative` as magnitudes. */
  recordSigned(name: string, value: bigint | number): void {
    const v = typeof value === "bigint" ? Number(value) : value;
    if (v < 0) {
      this.record(`${name}.negative`, -v);
      this.count(`${name}.negative_count`);
    } else {
      this.record(name, v);
    }
  }

  count(name: string, by = 1): void {
    this.counterRef(name).value += by;
  }

  /** The named histogram, or undefined when nothing was recorded into it. */
  histogram(name: string): Histogram | undefined {
    const m = this.metrics.get(name);
    return m && m.hist.count > 0 ? m.hist : undefined;
  }

  counter(name: string): number {
    if (name.startsWith("deadline_miss.")) return this.metrics.get(name.slice("deadline_miss.".length))?.misses ?? 0;
    return this.counters.get(name)?.value ?? 0;
  }

  private metric(name: string, unit = "ns"): Metric {
    let m = this.metrics.get(name);
    if (!m) {
      const deadline = this.deadlinesMs[name];
      m = new Metric(name, new Histogram(unit), deadline === undefined ? undefined : deadline * 1e6);
      this.metrics.set(name, m);
    }
    return m;
  }

  /** Counters keyed by a bounded (group, outcome) pair, without building the name each time. */
  private readonly outcomeCounters = new Map<string, Map<string, Counter>>();

  private _outcomeCounter(group: string, outcome: string): Counter {
    let byOutcome = this.outcomeCounters.get(group);
    if (!byOutcome) {
      byOutcome = new Map();
      this.outcomeCounters.set(group, byOutcome);
    }
    let c = byOutcome.get(outcome);
    if (!c) {
      c = this.counterRef(group.includes(".") ? `${group}.${outcome}` : `${group}.outcome.${outcome}`);
      byOutcome.set(outcome, c);
    }
    return c;
  }

  private counterRef(name: string): Counter {
    let c = this.counters.get(name);
    if (!c) {
      c = new Counter();
      this.counters.set(name, c);
    }
    return c;
  }

  // ------------------------------------------------------------------
  // MarketDataProbe
  // ------------------------------------------------------------------

  onFrame(frame: InboundFrame): void {
    this.cFrames.value++;
    // Alpaca frames are ASCII JSON, so characters equal bytes.
    this.hFrameChars.add(frame.text.length);
    if (frame.epoch === this.lastFrameEpoch && frame.rxMonoNs >= this.lastFrameMono) {
      this.hInterarrival.add(Number(frame.rxMonoNs - this.lastFrameMono));
    }
    this.lastFrameEpoch = frame.epoch;
    this.lastFrameMono = frame.rxMonoNs;
  }

  onLifecycle(event: StreamLifecycleEvent): void {
    this.count(`lifecycle.${event.kind}`);
    if (event.kind === "subscription_ack" && event.detail) this.lastSubscriptionAck = event.detail;
    if (this.lifecycleRecords.length >= MAX_LIFECYCLE_RECORDS) {
      this.lifecycleRecords.shift();
      this.count("lifecycle.records_dropped");
    }
    this.lifecycleRecords.push({
      kind: event.kind,
      epoch: event.epoch,
      wall_ms: event.wallMs,
      mono_ns: event.monoNs.toString(),
      ...(event.detail ? { detail: event.detail } : {}),
    });
  }

  frameParsed(frame: InboundFrame, messageCount: number, parseEndNs: bigint, ok: boolean): void {
    if (!ok) {
      this.count("frames.parse_failed");
      return;
    }
    // parseEndNs is 0n at frame detail: the adapter skips that clock read.
    if (parseEndNs > 0n) this.hFrameParse.add(Number(parseEndNs - frame.rxMonoNs));
    this.hFrameMessages.add(messageCount);
  }

  frameTrace(frame: InboundFrame): EventTrace {
    this.framesTotal++;
    this.frameSampled = this.sampleProbability > 0 && this.random() < this.sampleProbability;
    return { id: `${frame.epoch}:${frame.seq}`, rxMonoNs: Number(frame.rxMonoNs) };
  }

  marketEventLite(frame: InboundFrame, kind: MarketEventKind, providerTs: string, issue: MarketDataIssue | null, quarantined: boolean): void {
    const h = this.byKind[kind];
    h.events.value++;
    this.tracesTotal++;
    if (issue) this.count(`issues.${kind}.${issue.code}`);
    if (quarantined) h.quarantined.value++;
    this._recordAge(h, kind, frame.rxWallMs, providerTs);
  }

  frameDone(frame: InboundFrame, endNs: bigint): void {
    this.hFrameDone.add(Number(endNs - frame.rxMonoNs));
    if (this.frameSampled && !this.stageDetail) {
      this.frameSampled = false;
      this.tracesSampled++;
      this._retain({
        schema_version: PROBE_SCHEMA_VERSION,
        record: "frame",
        run_id: this.runId,
        clock_domain_id: CLOCK_DOMAIN_ID,
        trace_id: `${frame.epoch}:${frame.seq}`,
        connection_epoch: frame.epoch,
        frame_sequence: frame.seq,
        receive_wall_epoch_ms: frame.rxWallMs,
        receive_monotonic_ns: frame.rxMonoNs.toString(),
        stages: [{ stage: "frame", start_ns: frame.rxMonoNs.toString(), end_ns: endNs.toString() }],
        normalization_version: this.normalizationVersion,
        sampled: true,
        sample_probability: this.sampleProbability,
      });
    }
  }

  /** Reused by _recordAge at frame detail to avoid an allocation per event. */
  private readonly _msParts = { epochMs: 0, subMsNs: 0 };

  private _recordAge(h: KindHandles, kind: MarketEventKind, rxWallMs: number, providerTs: string): void {
    // Stage detail keeps the provider's sub-ms digits; frame detail uses the
    // allocation-free ms parser (receipt is Date.now(), ms resolution, anyway).
    let p: { epochMs: number; subMsNs: number } | null;
    if (this.stageDetail) {
      p = parseRfc3339Parts(providerTs);
    } else {
      const ms = rfc3339ToEpochMs(providerTs);
      this._msParts.epochMs = ms;
      p = Number.isNaN(ms) ? null : this._msParts;
    }
    if (p === null) {
      h.unparseable.value++;
    } else if (kind === "bar") {
      // A bar's timestamp is its interval start; it cannot exist before the interval ends.
      const lag = (rxWallMs - (p.epochMs + BAR_INTERVAL_MS)) * 1e6 - p.subMsNs;
      if (lag < 0) {
        this.hBarLagNeg.add(-lag);
        this.cBarLagNeg.value++;
      } else {
        this.hBarLag.add(lag);
      }
    } else {
      const age = (rxWallMs - p.epochMs) * 1e6 - p.subMsNs;
      if (age < 0) {
        h.ageNeg.add(-age);
        h.ageNegCount.value++;
      } else {
        h.age.add(age);
      }
    }
  }

  marketEvent(obs: MarketEventObservation): string {
    const { frame, index, kind } = obs;
    const h = this.byKind[kind];
    const id = `${frame.epoch}:${frame.seq}:${index}`;
    h.events.value++;
    this.tracesTotal++;
    if (obs.issue) this.count(`issues.${kind}.${obs.issue.code}`);
    if (obs.quarantined) h.quarantined.value++;

    h.queue.add(Number(obs.normStartNs - frame.rxMonoNs));
    h.normalize.add(Number(obs.normEndNs - obs.normStartNs));

    this._recordAge(h, kind, frame.rxWallMs, obs.providerTs);

    const sampled = this.sampleProbability > 0 && this.random() < this.sampleProbability;
    if (sampled) this.tracesSampled++;
    if (this.openTraces.size >= this.maxOpenTraces) {
      const oldest = this.openTraces.keys().next().value;
      if (oldest !== undefined) this.openTraces.delete(oldest);
      this.openTraceEvictions++;
    }
    this.openTraces.set(id, {
      id, kind, symbol: obs.symbol, frame, index, providerTs: obs.providerTs, sampled,
      spans: sampled ? [{ stage: "normalize", startNs: obs.normStartNs, endNs: obs.normEndNs }] : [],
      issue: obs.issue, quarantined: obs.quarantined,
    });
    if (obs.quarantined) this.dispatched(id, obs.normEndNs, obs.normEndNs, "quarantined");
    return id;
  }

  dispatched(traceId: string, startNs: bigint, endNs: bigint, outcome?: string): void {
    const t = this.openTraces.get(traceId);
    if (!t) {
      this.count("traces.uncorrelated_dispatch");
      return;
    }
    this.openTraces.delete(traceId);
    if (!outcome) {
      const h = this.byKind[t.kind];
      h.dispatch.add(Number(endNs - startNs));
      h.receiveToDispatchEnd.add(Number(endNs - t.frame.rxMonoNs));
    }
    if (t.sampled) {
      t.spans.push({ stage: "dispatch", startNs, endNs, ...(outcome ? { outcome } : {}) });
      this._retain({
        schema_version: PROBE_SCHEMA_VERSION,
        record: "market_event",
        run_id: this.runId,
        clock_domain_id: CLOCK_DOMAIN_ID,
        trace_id: t.id,
        connection_epoch: t.frame.epoch,
        frame_sequence: t.frame.seq,
        event_index_in_frame: t.index,
        event_kind: t.kind,
        symbol: t.symbol,
        provider_timestamp_raw: t.providerTs,
        provider_timestamp_semantics: t.kind === "bar" ? "bar_interval_start" : "provider_event_time",
        provider_epoch_ns: s(parseRfc3339ToEpochNs(t.providerTs)),
        receive_wall_epoch_ms: t.frame.rxWallMs,
        receive_monotonic_ns: t.frame.rxMonoNs.toString(),
        normalization_version: this.normalizationVersion,
        issue: t.issue?.code ?? null,
        status: outcome ?? "dispatched",
        stages: t.spans.map(spanJson),
        sampled: true,
        sample_probability: this.sampleProbability,
      });
    }
  }

  revision(kind: string): void {
    this.count(`revisions.${kind}`);
  }

  unhandledMessage(type: string): void {
    this.count(`messages.unhandled.${type || "missing_T"}`);
  }

  // ------------------------------------------------------------------
  // EngineProbe
  // ------------------------------------------------------------------

  span(
    trace: EventTrace | undefined,
    stage: EngineStage,
    startNs: bigint,
    endNs: bigint,
    outcome?: string,
    intentId?: string,
  ): void {
    const t = trace ? this.openTraces.get(trace.id) : undefined;
    const d = Number(endNs - startNs);
    if (stage === "evaluate") {
      this.hEvaluate.add(d);
      if (outcome === "no_signal") this.cEvalNoSignal.value++;
      else if (outcome === "signal") this.cEvalSignal.value++;
      else if (outcome === "error") this.cEvalError.value++;
    } else {
      const h = this.byKind[t?.kind ?? "untraced"];
      (stage === "state" ? h.state : h.risk).add(d);
      if (outcome) this._outcomeCounter(stage, outcome).value++;
    }
    if (t?.sampled) t.spans.push({ stage, startNs, endNs, ...(outcome ? { outcome } : {}) });
    const it = intentId ? this.openIntents.get(intentId) : undefined;
    if (it) {
      if (it.sampled) it.spans.push({ stage, startNs, endNs, ...(outcome ? { outcome } : {}) });
      if (outcome && outcome !== "passed") this._finishIntent(it, outcome);
    }
  }

  intentReady(intentId: string, trace: EventTrace | undefined, ns: bigint): void {
    const t = trace && this.stageDetail ? this.openTraces.get(trace.id) : undefined;
    if (!trace) this.count("traces.uncorrelated_intent");
    if (this.openIntents.size >= this.maxOpenIntents) {
      const oldest = this.openIntents.keys().next().value;
      if (oldest !== undefined) this.openIntents.delete(oldest);
      this.intentEvictions++;
    }
    const it: IntentTrace = {
      intentId,
      traceId: trace?.id ?? null,
      kind: t?.kind ?? "untraced",
      rxMonoNs: trace?.rxMonoNs ?? null,
      sampled: t?.sampled ?? (trace !== undefined && this.frameSampled),
      spans: [],
      submitStartNs: null,
      firstUpdateSeen: false,
    };
    this.openIntents.set(intentId, it);
    if (it.rxMonoNs !== null) this.hReceiveToIntent.add(Number(ns) - it.rxMonoNs);
    this.count("intents.ready");
  }

  // ------------------------------------------------------------------
  // OrderPathProbe
  // ------------------------------------------------------------------

  journal(intentId: string, startNs: bigint, endNs: bigint, outcome: string): void {
    this.hJournal.add(Number(endNs - startNs));
    this.count(`journal.outcome.${outcome}`);
    const it = this.openIntents.get(intentId);
    if (!it) {
      this.count("traces.uncorrelated_journal");
      return;
    }
    if (it.sampled) it.spans.push({ stage: "journal", startNs, endNs, outcome });
    if (outcome !== "ok") this._finishIntent(it, `journal_${outcome}`);
  }

  submitStart(intentId: string, ns: bigint): void {
    this.count("submit.started");
    const it = this.openIntents.get(intentId);
    if (!it) {
      this.count("traces.uncorrelated_submit");
      return;
    }
    it.submitStartNs = ns;
    if (it.rxMonoNs !== null) this.hReceiveToSubmit.add(Number(ns) - it.rxMonoNs);
  }

  responseHeaders(intentId: string, ns: bigint): void {
    const it = this.openIntents.get(intentId);
    if (!it || it.submitStartNs === null) return;
    this.metric("order.submit_to_response_headers_ns").add(Number(ns - it.submitStartNs));
    if (it.sampled) it.spans.push({ stage: "response_headers", startNs: ns, endNs: ns });
  }

  submitEnd(intentId: string, ns: bigint, outcome: string): void {
    this.count(`submit.outcome.${outcome}`);
    const it = this.openIntents.get(intentId);
    if (!it || it.submitStartNs === null) return;
    this.hSubmitToResponse.add(Number(ns - it.submitStartNs));
    if (it.sampled) it.spans.push({ stage: "submit", startNs: it.submitStartNs, endNs: ns, outcome });
    if (outcome !== "ok") this._finishIntent(it, `submit_${outcome}`);
  }

  orderUpdate(orderId: string, kind: OrderUpdateKind, ns: bigint): void {
    this.count(`order_update.${kind}`);
    const it = this.openIntents.get(orderId);
    if (!it) return;
    if (!it.firstUpdateSeen && kind !== "submitted" && it.submitStartNs !== null) {
      it.firstUpdateSeen = true;
      this.hSubmitToFirstUpdate.add(Number(ns - it.submitStartNs));
    }
    if (it.sampled) it.spans.push({ stage: `update_${kind}`, startNs: ns, endNs: ns });
    if (kind === "canceled" || kind === "rejected" || kind === "expired") this._finishIntent(it, kind);
  }

  fillApplied(orderId: string, ns: bigint, terminal: boolean): void {
    const it = this.openIntents.get(orderId);
    if (!it) return;
    if (it.rxMonoNs !== null) this.hReceiveToFill.add(Number(ns) - it.rxMonoNs);
    if (it.sampled) it.spans.push({ stage: terminal ? "fill_applied" : "partial_fill_applied", startNs: ns, endNs: ns });
    if (terminal) this._finishIntent(it, "filled");
  }

  // ------------------------------------------------------------------
  // Export
  // ------------------------------------------------------------------

  snapshot(): ProbeSnapshot {
    const histograms: Record<string, HistogramJSON> = {};
    const counters: Record<string, number> = {};
    for (const [name, m] of this.metrics) {
      if (m.hist.count > 0) histograms[name] = m.hist.toJSON();
      if (m.misses > 0) counters[`deadline_miss.${name}`] = m.misses;
    }
    for (const [name, c] of this.counters) if (c.value !== 0) counters[name] = c.value;
    const sortKeys = <T>(o: Record<string, T>): Record<string, T> =>
      Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
    return {
      schema_version: PROBE_SCHEMA_VERSION,
      run_id: this.runId,
      clock_domain_id: CLOCK_DOMAIN_ID,
      boot_id: BOOT_ID,
      process_id: process.pid,
      normalization_version: this.normalizationVersion,
      started_wall_ms: this.startedWallMs,
      captured_wall_ms: wallMs(),
      elapsed_ns: (this.clock() - this.startedMonoNs).toString(),
      sampling: {
        probability: this.sampleProbability,
        traces_total: this.tracesTotal,
        traces_sampled: this.tracesSampled,
        traces_retained: this.reservoir.length,
        open_trace_evictions: this.openTraceEvictions,
        intent_evictions: this.intentEvictions,
        detail: this.stageDetail ? "stage" : "frame",
        frames_total: this.framesTotal,
      },
      counters: sortKeys(counters),
      deadlines_ms: { ...this.deadlinesMs },
      histograms: sortKeys(histograms),
      lifecycle: [...this.lifecycleRecords],
      last_subscription_ack: this.lastSubscriptionAck,
    };
  }

  /** Retained detailed traces (a uniform reservoir over all sampled records). */
  traceSamples(): TraceRecord[] {
    return [...this.reservoir];
  }

  /** Percentile summaries in ms for every non-empty histogram whose unit is ns. */
  summaries(): Record<string, LatencySummary> {
    const out: Record<string, LatencySummary> = {};
    for (const [name, m] of this.metrics) {
      if (m.hist.unit === "ns" && m.hist.count > 0) out[name] = summarizeHistogram(m.hist);
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  private _finishIntent(it: IntentTrace, status: string): void {
    if (!this.openIntents.delete(it.intentId)) return;
    this._outcomeCounter("intents.finished", status).value++;
    if (!it.sampled) return;
    this._retain({
      schema_version: PROBE_SCHEMA_VERSION,
      record: "intent",
      run_id: this.runId,
      clock_domain_id: CLOCK_DOMAIN_ID,
      intent_id: it.intentId,
      client_order_id: it.intentId,
      parent_trace_id: it.traceId,
      event_kind: it.kind,
      receive_monotonic_ns: it.rxMonoNs === null ? null : String(it.rxMonoNs),
      status,
      stages: it.spans.map(spanJson),
      sampled: true,
      sample_probability: this.sampleProbability,
    });
  }

  /** Algorithm R: every sampled record has equal chance of being retained. */
  private _retain(record: TraceRecord): void {
    this.sampledRecordsSeen++;
    if (this.reservoir.length < this.maxTraceSamples) {
      this.reservoir.push(record);
      return;
    }
    const j = Math.floor(this.random() * this.sampledRecordsSeen);
    if (j < this.maxTraceSamples) this.reservoir[j] = record;
    this.count("traces.reservoir_replaced");
  }
}
