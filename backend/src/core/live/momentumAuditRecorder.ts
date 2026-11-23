/**
 * core/live/momentumAuditRecorder.ts
 *
 * Audit trail for the momentum strategy (plan P2-6, tables from migration
 * 0020). For every order it keeps the chain: first-seen bar -> signal -> risk
 * decision -> order request -> submit/ack -> fill or cancel -> resulting
 * account state. Bar corrections (Alpaca updatedBars, BAR_REVISED) go to their
 * own table and never touch the first-seen bar rows.
 *
 * `attach(bus)` subscribes synchronous handlers that only append to in-memory
 * buffers, so the in-order, deterministic event dispatch is untouched and a
 * slow database cannot stall the trading path. Buffers are written in batches
 * by `flush`; a failed write is retried and a prolonged outage drops the oldest
 * rows (counted and logged) rather than growing memory.
 *
 * Inputs:  Bar, signal, risk, order and portfolio events from the EventBus.
 * Outputs: Rows handed to the injected insert functions (tables in 0020).
 */

import { logger } from "../../utils/logger";
import type { EventBus } from "../engine/eventBus";
import type { Bar } from "../../types/market";
import type {
  BarReceivedEvent,
  BarRevisedEvent,
  CapitalUnavailableEvent,
  OrderAcknowledgedEvent,
  OrderCanceledEvent,
  OrderExpiredEvent,
  OrderFilledEvent,
  OrderIntentCreatedEvent,
  OrderPartialFillEvent,
  OrderRejectedEvent,
  OrderSubmittedEvent,
  PortfolioUpdatedEvent,
  RiskRejectedEvent,
  StrategySignalCreatedEvent,
} from "../../types/events";

export type AuditStage =
  | "signal" | "risk_rejected" | "capital_unavailable" | "order_request" | "submitted"
  | "ack" | "partial_fill" | "fill" | "cancel" | "reject" | "expire" | "account_state";

export interface AuditBarRow {
  run_id: string | null;
  symbol: string;
  timeframe: string;
  bar_ts: string;
  first_seen_at: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
  trade_count: number | null;
}

export interface BarCorrectionRow extends Omit<AuditBarRow, "first_seen_at"> {
  received_at: string;
}

export interface AuditEventRow {
  run_id: string | null;
  stage: AuditStage;
  ts: string;
  symbol: string | null;
  signal_id: string | null;
  intent_id: string | null;
  order_id: string | null;
  broker_order_id: string | null;
  bar_symbol: string | null;
  bar_timeframe: string | null;
  bar_ts: string | null;
  bar_first_seen_at: string | null;
  qty: number | null;
  price: number | null;
  detail: Record<string, unknown>;
}

export interface MomentumAuditRecorderDeps {
  insertBars(rows: AuditBarRow[]): Promise<void>;
  insertEvents(rows: AuditEventRow[]): Promise<void>;
  insertCorrections(rows: BarCorrectionRow[]): Promise<void>;
  /** Run the rows belong to when an event does not carry one. */
  runId: string | null;
}

export interface MomentumAuditRecorderOptions {
  flushMs: number;
  /** Cap per buffer; the oldest rows are dropped beyond it. */
  maxBuffered: number;
  /** Cap on signal/intent/order links kept in memory; the oldest are forgotten beyond it. */
  maxTracked: number;
}

interface BarRef {
  symbol: string;
  timeframe: string;
  barTs: string;
  firstSeenAt: string;
}

interface Link {
  runId: string | null;
  signalId: string | null;
  intentId: string | null;
  bar: BarRef | null;
}

class Buffer<T> {
  rows: T[] = [];
  dropped = 0;
  constructor(private readonly cap: number) {}

  push(row: T): void {
    this.rows.push(row);
    this.trim();
  }

  /** Puts a failed batch back in front of rows recorded meanwhile. */
  requeue(batch: T[]): void {
    this.rows = [...batch, ...this.rows];
    this.trim();
  }

  take(): T[] {
    const batch = this.rows;
    this.rows = [];
    return batch;
  }

  private trim(): void {
    if (this.rows.length > this.cap) {
      const overflow = this.rows.length - this.cap;
      this.rows.splice(0, overflow);
      this.dropped += overflow;
    }
  }
}

const iso = (ms: number): string => new Date(ms).toISOString();

export class MomentumAuditRecorder {
  private readonly bars: Buffer<AuditBarRow>;
  private readonly events: Buffer<AuditEventRow>;
  private readonly corrections: Buffer<BarCorrectionRow>;
  private readonly seenBars = new Set<string>();
  private readonly latestBar = new Map<string, BarRef>();
  private readonly signals = new Map<string, Link>(); // by signal id
  private readonly intents = new Map<string, Link>(); // by intent id
  private readonly orders = new Map<string, Link & { brokerOrderId: string | null }>(); // by order id
  private readonly awaitingState = new Set<string>(); // order ids waiting for a portfolio update
  private readonly filled = new Set<string>(); // fully filled; dropped once their account_state is written
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly deps: MomentumAuditRecorderDeps,
    private readonly options: MomentumAuditRecorderOptions,
  ) {
    this.bars = new Buffer(options.maxBuffered);
    this.events = new Buffer(options.maxBuffered);
    this.corrections = new Buffer(options.maxBuffered);
  }

  /** Subscribes to the bus. Handlers are synchronous and never throw into it. */
  attach(bus: EventBus): void {
    bus.on<BarReceivedEvent>("BAR_RECEIVED", (e) => this.onBar(e));
    bus.on<BarRevisedEvent>("BAR_REVISED", (e) => this.onBarRevised(e));
    bus.on<StrategySignalCreatedEvent>("STRATEGY_SIGNAL_CREATED", (e) => this.onSignal(e));
    bus.on<RiskRejectedEvent>("RISK_REJECTED", (e) => this.onRiskRejected(e));
    bus.on<CapitalUnavailableEvent>("CAPITAL_UNAVAILABLE", (e) => this.onCapitalUnavailable(e));
    bus.on<OrderIntentCreatedEvent>("ORDER_INTENT_CREATED", (e) => this.onIntent(e));
    bus.on<OrderSubmittedEvent>("ORDER_SUBMITTED", (e) => this.onSubmitted(e));
    bus.on<OrderAcknowledgedEvent>("ORDER_ACKNOWLEDGED", (e) => this.onAck(e));
    bus.on<OrderPartialFillEvent>("ORDER_PARTIAL_FILL", (e) => this.onFill(e, "partial_fill"));
    bus.on<OrderFilledEvent>("ORDER_FILLED", (e) => this.onFill(e, "fill"));
    bus.on<OrderCanceledEvent>("ORDER_CANCELED", (e) => this.onTerminal(e.orderId, "cancel", e.ts, { reason: e.reason ?? null }));
    bus.on<OrderRejectedEvent>("ORDER_REJECTED", (e) => this.onTerminal(e.orderId, "reject", e.ts, { reason: e.reason }));
    bus.on<OrderExpiredEvent>("ORDER_EXPIRED", (e) => this.onTerminal(e.orderId, "expire", e.ts, {}));
    bus.on<PortfolioUpdatedEvent>("PORTFOLIO_UPDATED", (e) => this.onPortfolio(e));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.options.flushMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  /** Writes the buffered rows. Concurrent calls share one write. */
  flush(): Promise<void> {
    if (!this.flushing) {
      this.flushing = this.doFlush().finally(() => { this.flushing = null; });
    }
    return this.flushing;
  }

  // ----------------------------------------------------------------
  // Bars
  // ----------------------------------------------------------------

  private onBar(e: BarReceivedEvent): void {
    const bar = e.payload;
    const key = `${bar.symbol}|${bar.timeframe}|${bar.ts}`;
    const ref: BarRef = { symbol: bar.symbol, timeframe: bar.timeframe, barTs: iso(bar.ts), firstSeenAt: iso(e.ts) };
    this.latestBar.set(bar.symbol, ref);
    if (this.seenBars.has(key)) return; // the first sighting stands
    this.seenBars.add(key);
    if (this.seenBars.size > this.options.maxTracked) {
      this.seenBars.delete(this.seenBars.values().next().value as string);
    }
    this.bars.push({ run_id: this.deps.runId, ...barFields(bar), first_seen_at: ref.firstSeenAt });
  }

  private onBarRevised(e: BarRevisedEvent): void {
    this.corrections.push({ run_id: this.deps.runId, ...barFields(e.payload), received_at: iso(e.ts) });
  }

  // ----------------------------------------------------------------
  // Chain
  // ----------------------------------------------------------------

  private onSignal(e: StrategySignalCreatedEvent): void {
    const signalId = e.signalId ?? e.payload.id;
    const link: Link = {
      runId: e.runKey ?? this.deps.runId,
      signalId,
      intentId: null,
      bar: this.latestBar.get(e.payload.symbol) ?? null,
    };
    remember(this.signals, signalId, link, this.options.maxTracked);
    this.addEvent("signal", e.ts, link, e.payload.symbol, { qty: e.payload.qty }, { signal: e.payload });
  }

  private onRiskRejected(e: RiskRejectedEvent): void {
    const intent = e.rejectedIntent;
    const link = this.linkForIntent(intent.id, intent.signalId, intent.runId, intent.symbol);
    this.addEvent("risk_rejected", e.ts, link, intent.symbol, {}, {
      failedCheck: e.failedCheck ?? null, reason: e.reason, intent,
    });
  }

  private onCapitalUnavailable(e: CapitalUnavailableEvent): void {
    const link = this.linkForIntent(e.intentId, e.signalId, e.runId, null);
    this.addEvent("capital_unavailable", e.ts, link, null, {}, { required: e.required, available: e.available });
  }

  private onIntent(e: OrderIntentCreatedEvent): void {
    const i = e.payload;
    const link = this.linkForIntent(i.id, i.signalId, i.runId, i.symbol);
    this.addEvent("order_request", e.ts, link, i.symbol, { qty: i.qty, price: i.limitPrice ?? null }, { intent: i });
  }

  private onSubmitted(e: OrderSubmittedEvent): void {
    const o = e.payload;
    const base = this.linkForIntent(o.intentId, o.signalId, o.runId, o.symbol);
    const link = { ...base, brokerOrderId: o.brokerOrderId ?? null };
    remember(this.orders, o.id, link, this.options.maxTracked);
    this.addEvent("submitted", e.ts, link, o.symbol, { qty: o.qty, price: o.limitPrice ?? null }, { order: o }, o.id, o.brokerOrderId ?? null);
  }

  private onAck(e: OrderAcknowledgedEvent): void {
    const known = this.orders.get(e.orderId);
    if (known) known.brokerOrderId = e.brokerOrderId;
    const link = known ?? this.unknownLink();
    this.addEvent("ack", e.ts, link, null, {}, {}, e.orderId, e.brokerOrderId);
  }

  private onFill(e: OrderPartialFillEvent | OrderFilledEvent, stage: "partial_fill" | "fill"): void {
    const link = this.orders.get(e.orderId) ?? this.unknownLink();
    const detail: Record<string, unknown> = { fill: e.fill };
    if (e.type === "ORDER_PARTIAL_FILL") detail["remainingQty"] = e.remainingQty;
    this.addEvent(stage, e.ts, link, e.fill.symbol, { qty: e.fill.qty, price: e.fill.price }, detail, e.orderId, link.brokerOrderId ?? null);
    this.awaitingState.add(e.orderId);
    if (stage === "fill") this.filled.add(e.orderId);
  }

  private onTerminal(orderId: string, stage: AuditStage, ts: number, detail: Record<string, unknown>): void {
    const link = this.orders.get(orderId) ?? this.unknownLink();
    this.addEvent(stage, ts, link, null, {}, detail, orderId, link.brokerOrderId ?? null);
    this.orders.delete(orderId);
  }

  /** The state each fill left behind is the first portfolio update after it. */
  private onPortfolio(e: PortfolioUpdatedEvent): void {
    if (this.awaitingState.size === 0) return;
    const snap = e.payload;
    const detail = {
      equity: snap.equity, cash: snap.cash, positionsValue: snap.positionsValue,
      totalRealizedPnl: snap.totalRealizedPnl, totalUnrealizedPnl: snap.totalUnrealizedPnl,
      positions: snap.positions,
    };
    for (const orderId of this.awaitingState) {
      const link = this.orders.get(orderId) ?? this.unknownLink();
      this.addEvent("account_state", e.ts, link, null, {}, detail, orderId, link.brokerOrderId ?? null);
      if (this.filled.delete(orderId)) this.orders.delete(orderId);
    }
    this.awaitingState.clear();
  }

  private linkForIntent(
    intentId: string,
    signalId: string | undefined,
    runId: string | undefined,
    symbol: string | null,
  ): Link {
    const known = this.intents.get(intentId);
    if (known) return known;
    const fromSignal = signalId ? this.signals.get(signalId) : undefined;
    const link: Link = {
      runId: runId ?? fromSignal?.runId ?? this.deps.runId,
      signalId: signalId ?? null,
      intentId,
      bar: fromSignal?.bar ?? (symbol ? this.latestBar.get(symbol) ?? null : null),
    };
    remember(this.intents, intentId, link, this.options.maxTracked);
    return link;
  }

  private unknownLink(): Link & { brokerOrderId: string | null } {
    return { runId: this.deps.runId, signalId: null, intentId: null, bar: null, brokerOrderId: null };
  }

  private addEvent(
    stage: AuditStage,
    ts: number,
    link: Link,
    symbol: string | null,
    nums: { qty?: number | null; price?: number | null },
    detail: Record<string, unknown>,
    orderId: string | null = null,
    brokerOrderId: string | null = null,
  ): void {
    this.events.push({
      run_id: link.runId,
      stage,
      ts: iso(ts),
      symbol,
      signal_id: link.signalId,
      intent_id: link.intentId,
      order_id: orderId,
      broker_order_id: brokerOrderId,
      bar_symbol: link.bar?.symbol ?? null,
      bar_timeframe: link.bar?.timeframe ?? null,
      bar_ts: link.bar?.barTs ?? null,
      bar_first_seen_at: link.bar?.firstSeenAt ?? null,
      qty: nums.qty ?? null,
      price: nums.price ?? null,
      detail,
    });
  }

  // ----------------------------------------------------------------
  // Writing
  // ----------------------------------------------------------------

  private async doFlush(): Promise<void> {
    for (const [name, buf] of [["bars", this.bars], ["events", this.events], ["corrections", this.corrections]] as const) {
      if (buf.dropped > 0) {
        logger.warn("MomentumAuditRecorder: dropped rows while the database was unreachable", { table: name, dropped: buf.dropped });
        buf.dropped = 0;
      }
    }
    await this.writeBuffer("bars", this.bars, (r) => this.deps.insertBars(r));
    await this.writeBuffer("events", this.events, (r) => this.deps.insertEvents(r));
    await this.writeBuffer("corrections", this.corrections, (r) => this.deps.insertCorrections(r));
  }

  private async writeBuffer<T>(name: string, buf: Buffer<T>, insert: (rows: T[]) => Promise<void>): Promise<void> {
    const batch = buf.take();
    if (batch.length === 0) return;
    try {
      await insert(batch);
    } catch (err) {
      logger.warn("MomentumAuditRecorder: write failed, will retry", { table: name, count: batch.length, err: String(err) });
      buf.requeue(batch);
    }
  }
}

function barFields(bar: Bar) {
  return {
    symbol: bar.symbol,
    timeframe: bar.timeframe,
    bar_ts: iso(bar.ts),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    vwap: bar.vwap ?? null,
    trade_count: bar.tradeCount ?? null,
  };
}

/** Inserts into a size-capped map, forgetting the oldest entry beyond the cap. */
function remember<V>(map: Map<string, V>, key: string, value: V, cap: number): void {
  map.set(key, value);
  if (map.size > cap) map.delete(map.keys().next().value as string);
}
