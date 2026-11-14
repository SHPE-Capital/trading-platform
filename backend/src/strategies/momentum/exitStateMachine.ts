/**
 * strategies/momentum/exitStateMachine.ts
 *
 * One exit state machine per momentum position (P2-3). Every exit path (broker
 * stop, trailing stop, time exit, session exit, emergency liquidation) goes
 * through it so that a position never has two sells in flight.
 *
 * The machine is pure and synchronous: it consumes events and returns
 * ExitCommands for the execution layer to carry out. It never calls a broker,
 * so replay is deterministic. Every event carries an `eventId`; a repeated
 * eventId is ignored, and every command id is derived from the position id and
 * a counter, so replaying the same event stream produces no second order.
 *
 * Order-flow recipe (docs/guides/alpaca-order-behavior.md section 5, still
 * UNVERIFIED against paper):
 *   - the stop covers only filled quantity and is resized on partial fills;
 *   - the trail replaces the stop upward only, and the next replace waits for
 *     the previous one to be acknowledged;
 *   - a market exit first cancels the resting stop and waits for the cancel to
 *     be confirmed; if the stop filled meanwhile, no sell is sent;
 *   - an exit that cannot be resolved (halt, rejection, timeout) becomes an
 *     exception and the position is never assumed flat.
 *
 * Every tunable comes from ExitConfig (protocol keys exit.*); no defaults here.
 */

export interface ExitConfig {
  /** exit.initial_stop_atr */
  initialStopAtr: number;
  /** exit.trail_activation_atr */
  trailActivationAtr: number;
  /** exit.trail_distance_atr */
  trailDistanceAtr: number;
  /** exit.max_hold_minutes */
  maxHoldMinutes: number;
  /** exit.session_exit_minutes_before_close */
  sessionExitMinutesBeforeClose: number;
  /** How long to wait for a stop cancel confirmation before raising an exception */
  cancelConfirmTimeoutMs: number;
  /** How long to wait for the market sell to fill before raising an exception */
  sellConfirmTimeoutMs: number;
}

export type ExitReason = "initial_stop" | "trailing_stop" | "time_exit" | "session_exit" | "emergency";

export type ExitState =
  | "AWAITING_ENTRY"
  | "PROTECTED"
  | "CANCELING_STOP"
  | "AWAITING_POSITION"
  | "SELLING"
  | "CLOSED"
  | "EXCEPTION";

export type ExitCommand =
  | { kind: "PLACE_STOP"; clientOrderId: string; symbol: string; qty: number; stopPrice: number }
  | { kind: "REPLACE_STOP"; brokerOrderId: string; clientOrderId: string; symbol: string; qty: number; stopPrice: number }
  | { kind: "CANCEL_STOP"; brokerOrderId: string; symbol: string }
  | { kind: "CANCEL_ENTRY"; symbol: string }
  | { kind: "READ_POSITION"; symbol: string }
  | { kind: "MARKET_SELL"; clientOrderId: string; symbol: string; qty: number; reason: ExitReason };

export interface ExitException {
  ts: number;
  reason: string;
}

interface BaseEvent {
  /** Unique per source event; a repeat is ignored (replay safety). */
  eventId: string;
  ts: number;
}

export type ExitEvent =
  /** Cumulative entry fill: qty is the total filled so far, price the average fill price. */
  | (BaseEvent & { type: "ENTRY_FILL"; cumQty: number; avgPrice: number })
  /** The entry order reached a terminal state (filled, canceled, expired). */
  | (BaseEvent & { type: "ENTRY_DONE" })
  /** A completed bar close. `ts` is the bar's end time. */
  | (BaseEvent & { type: "BAR_CLOSE"; close: number })
  /** Time passing (no market data needed): drives time/session exits and timeouts. */
  | (BaseEvent & { type: "CLOCK" })
  /** Liquidation requested by the daily halt (P2-4) or an operator. */
  | (BaseEvent & { type: "EMERGENCY" })
  /** The stop was created or replaced and is now resting under `brokerOrderId`. */
  | (BaseEvent & { type: "STOP_ACK"; brokerOrderId: string; qty: number; stopPrice: number })
  | (BaseEvent & { type: "STOP_REJECTED"; reason: string })
  | (BaseEvent & { type: "STOP_FILLED"; qty: number })
  | (BaseEvent & { type: "STOP_CANCELED" })
  /** The stop cancel failed. `alreadyTerminal` means the broker says it is no longer cancelable. */
  | (BaseEvent & { type: "CANCEL_REJECTED"; alreadyTerminal: boolean })
  /** Result of READ_POSITION (the broker's position, not our ledger). */
  | (BaseEvent & { type: "POSITION_READ"; qty: number })
  | (BaseEvent & { type: "SELL_FILLED"; qty: number })
  /** `heldQty` marks the "insufficient qty available" rejection (a stop still holds the shares). */
  | (BaseEvent & { type: "SELL_REJECTED"; reason: string; heldQty?: boolean })
  | (BaseEvent & { type: "HALTED" });

export interface ExitPositionParams {
  positionId: string;
  symbol: string;
  /** ATR14 at entry; fixed for the life of the trade. */
  atrAtEntry: number;
  /** Actual session close (early-close days pass the early close). */
  sessionCloseTs: number;
  config: ExitConfig;
}

const MINUTE_MS = 60_000;

export class ExitStateMachine {
  readonly positionId: string;
  readonly symbol: string;
  private readonly atr: number;
  private readonly sessionCloseTs: number;
  private readonly cfg: ExitConfig;

  private _state: ExitState = "AWAITING_ENTRY";
  private readonly seen = new Set<string>();
  private readonly _exceptions: ExitException[] = [];
  private readonly _notes: ExitException[] = [];

  private entryOpen = true;
  private filledQty = 0;
  private soldQty = 0;
  private entryPrice = 0;
  private firstFillTs: number | null = null;
  private highestClose = Number.NEGATIVE_INFINITY;

  /** Desired stop (qty = filled, price never lowered). Null until the first fill. */
  private stopPrice: number | null = null;
  private trailing = false;
  private stopOp: "idle" | "placing" | "replacing" = "idle";
  private stopOrderId: string | null = null;
  private ackedQty = 0;
  private ackedPrice = 0;
  private stopSeq = 0;
  private sellSeq = 0;
  private sellRetried = false;

  private exitReason: ExitReason | null = null;
  /** Exit requested while a stop operation was in flight; flushed on the ack. */
  private deferredExit: ExitReason | null = null;
  private waitingSince = 0;
  private halted = false;

  constructor(params: ExitPositionParams) {
    const { atrAtEntry, config } = params;
    if (!Number.isFinite(atrAtEntry) || atrAtEntry <= 0) throw new Error(`ExitStateMachine: atrAtEntry must be > 0 (got ${atrAtEntry})`);
    this.positionId = params.positionId;
    this.symbol = params.symbol;
    this.atr = atrAtEntry;
    this.sessionCloseTs = params.sessionCloseTs;
    this.cfg = config;
  }

  get state(): ExitState {
    return this._state;
  }
  /** The reason the position closed or is closing (null while it is just open). */
  get reason(): ExitReason | null {
    return this.exitReason;
  }
  get exceptions(): readonly ExitException[] {
    return this._exceptions;
  }
  /** Informational transitions that are not exceptions (closed by X, halt noted). */
  get notes(): readonly ExitException[] {
    return this._notes;
  }
  get currentStopPrice(): number | null {
    return this.stopPrice;
  }
  get remainingQty(): number {
    return Math.max(0, this.filledQty - this.soldQty);
  }
  /** True only once the position is confirmed flat. An EXCEPTION is never flat. */
  get isFlat(): boolean {
    return this._state === "CLOSED";
  }
  /** True once no further events can change the position (closed or in exception). */
  get isTerminal(): boolean {
    return this._state === "CLOSED" || this._state === "EXCEPTION";
  }

  /** Applies one event and returns the commands to execute, in order. */
  handle(ev: ExitEvent): ExitCommand[] {
    if (this.seen.has(ev.eventId)) return [];
    this.seen.add(ev.eventId);
    if (this.isTerminal) return [];

    switch (ev.type) {
      case "ENTRY_FILL":
        return this.onEntryFill(ev.cumQty, ev.avgPrice, ev.ts);
      case "ENTRY_DONE":
        this.entryOpen = false;
        if (this.filledQty === 0 && this._state === "AWAITING_ENTRY") this._state = "CLOSED";
        return [];
      case "BAR_CLOSE":
        return this.onBarClose(ev.close, ev.ts);
      case "CLOCK":
        return this.onClock(ev.ts);
      case "EMERGENCY":
        return this.requestExit("emergency", ev.ts);
      case "STOP_ACK":
        return this.onStopAck(ev.brokerOrderId, ev.qty, ev.stopPrice, ev.ts);
      case "STOP_REJECTED":
        return this.onStopRejected(ev.reason, ev.ts);
      case "STOP_FILLED":
        return this.onStopFilled(ev.qty, ev.ts);
      case "STOP_CANCELED":
        return this.onStopCanceled(ev.ts);
      case "CANCEL_REJECTED":
        return this.onCancelRejected(ev.alreadyTerminal, ev.ts);
      case "POSITION_READ":
        return this.onPositionRead(ev.qty, ev.ts);
      case "SELL_FILLED":
        return this.onSellFilled(ev.qty, ev.ts);
      case "SELL_REJECTED":
        return this.onSellRejected(ev.reason, ev.heldQty === true, ev.ts);
      case "HALTED":
        this.halted = true;
        if (this._state === "CANCELING_STOP" || this._state === "SELLING" || this._state === "AWAITING_POSITION") {
          this.raise(ev.ts, "symbol halted during exit; position not assumed flat");
        } else {
          this.log(ev.ts, "symbol halted; stop cannot trigger until trading resumes");
        }
        return [];
    }
  }

  // ------------------------------------------------------------------
  // Entry fills and the protective stop
  // ------------------------------------------------------------------

  private onEntryFill(cumQty: number, avgPrice: number, ts: number): ExitCommand[] {
    if (!(cumQty > this.filledQty) || !(avgPrice > 0)) return [];
    this.filledQty = cumQty;
    this.entryPrice = avgPrice;
    if (this.firstFillTs === null) this.firstFillTs = ts;
    if (this._state === "AWAITING_ENTRY") {
      this._state = "PROTECTED";
      if (this.exitReason !== null) {
        // A fill that raced the entry cancel: the position exists, so exit it now.
        const reason = this.exitReason;
        this.exitReason = null;
        return this.requestExit(reason, ts);
      }
    }

    // Never lowered: a lower average fill price must not drag the stop down.
    const initial = avgPrice - this.cfg.initialStopAtr * this.atr;
    if (this.stopPrice === null || initial > this.stopPrice) this.stopPrice = initial;

    if (this.exitReason !== null) return []; // late fill while exiting; surfaced as residual after the sell
    return this.syncStop();
  }

  private onBarClose(close: number, ts: number): ExitCommand[] {
    // Only closes completed after the first fill count, and a level computed
    // from this bar is sent now, so it governs the next bar.
    if (this.firstFillTs === null || ts <= this.firstFillTs || this.exitReason !== null) return this.onClock(ts);
    if (close > this.highestClose) this.highestClose = close;
    if (this.highestClose >= this.entryPrice + this.cfg.trailActivationAtr * this.atr) {
      const candidate = this.highestClose - this.cfg.trailDistanceAtr * this.atr;
      if (this.stopPrice === null || candidate > this.stopPrice) {
        this.stopPrice = candidate;
        this.trailing = true;
      }
    }
    return [...this.syncStop(), ...this.onClock(ts)];
  }

  /**
   * Brings the broker stop to the desired qty and price. At most one stop
   * operation is in flight; a newer desired state is sent once it is acked.
   */
  private syncStop(): ExitCommand[] {
    if (this.stopOp !== "idle" || this.stopPrice === null || this.filledQty <= 0) return [];
    if (this.stopOrderId === null) {
      this.stopOp = "placing";
      return [{ kind: "PLACE_STOP", clientOrderId: this.nextStopId(), symbol: this.symbol, qty: this.remainingQty, stopPrice: this.stopPrice }];
    }
    if (this.ackedQty === this.remainingQty && this.ackedPrice === this.stopPrice) return [];
    this.stopOp = "replacing";
    return [{
      kind: "REPLACE_STOP",
      brokerOrderId: this.stopOrderId,
      clientOrderId: this.nextStopId(),
      symbol: this.symbol,
      qty: this.remainingQty,
      stopPrice: this.stopPrice,
    }];
  }

  private onStopAck(brokerOrderId: string, qty: number, stopPrice: number, ts: number): ExitCommand[] {
    this.stopOp = "idle";
    this.stopOrderId = brokerOrderId;
    this.ackedQty = qty;
    this.ackedPrice = stopPrice;
    if (this.deferredExit !== null) {
      const reason = this.deferredExit;
      this.deferredExit = null;
      return this.requestExit(reason, ts);
    }
    if (this.exitReason !== null) return [];
    return this.syncStop();
  }

  private onStopRejected(reason: string, ts: number): ExitCommand[] {
    // An unprotected position is a risk event, not a flat one. Keep tracking so
    // the time and session exits still close it (they sell without a cancel).
    const hadOrder = this.stopOrderId !== null;
    this.stopOp = "idle";
    this.raise(ts, `stop ${hadOrder ? "replace" : "placement"} rejected (${reason}); position ${hadOrder ? "keeps the previous stop" : "unprotected"}`, false);
    if (this.deferredExit !== null) {
      const r = this.deferredExit;
      this.deferredExit = null;
      return this.requestExit(r, ts);
    }
    return [];
  }

  private onStopFilled(qty: number, ts: number): ExitCommand[] {
    this.soldQty += qty;
    if (this.remainingQty > 0) {
      // Partial stop fill: shrink the stop to what is left and keep going.
      this.ackedQty = this.remainingQty;
      return [];
    }
    // Includes the race where the stop fills while we were cancelling it: no sell.
    if (this.exitReason === null) this.exitReason = this.trailing ? "trailing_stop" : "initial_stop";
    this._state = "CLOSED";
    this.log(ts, `closed by ${this.exitReason}`);
    return [];
  }

  // ------------------------------------------------------------------
  // Exit paths
  // ------------------------------------------------------------------

  private onClock(ts: number): ExitCommand[] {
    // Confirmation timeouts first: an unresolved exit is never assumed flat.
    if (this._state === "CANCELING_STOP" && ts - this.waitingSince >= this.cfg.cancelConfirmTimeoutMs) {
      this.raise(ts, "stop cancel not confirmed in time; position not assumed flat");
      return [];
    }
    if (this._state === "SELLING" && ts - this.waitingSince >= this.cfg.sellConfirmTimeoutMs) {
      this.raise(ts, "market sell not confirmed in time; position not assumed flat");
      return [];
    }
    if (this.exitReason !== null || this.deferredExit !== null) return [];

    if (ts >= this.sessionCloseTs - this.cfg.sessionExitMinutesBeforeClose * MINUTE_MS) {
      return this.requestExit("session_exit", ts);
    }
    if (this.firstFillTs !== null && ts >= this.firstFillTs + this.cfg.maxHoldMinutes * MINUTE_MS) {
      return this.requestExit("time_exit", ts);
    }
    return [];
  }

  /** Single entry point for every non-stop exit. The first reason wins; later requests are ignored. */
  private requestExit(reason: ExitReason, ts: number): ExitCommand[] {
    if (this.exitReason !== null) return [];
    const cmds: ExitCommand[] = [];

    if (this.entryOpen) {
      this.entryOpen = false;
      cmds.push({ kind: "CANCEL_ENTRY", symbol: this.symbol });
    }
    if (this.filledQty === 0) {
      // Nothing to sell yet. Stay open until the entry order is terminal so a
      // fill that races the cancel is still exited (see onEntryFill).
      this.exitReason = reason;
      return cmds;
    }
    if (this.stopOp !== "idle") {
      // The stop's broker id is not known until the ack; cancel it then.
      this.deferredExit = reason;
      return cmds;
    }
    this.exitReason = reason;
    if (this.stopOrderId !== null) {
      this._state = "CANCELING_STOP";
      this.waitingSince = ts;
      cmds.push({ kind: "CANCEL_STOP", brokerOrderId: this.stopOrderId, symbol: this.symbol });
      return cmds;
    }
    return [...cmds, ...this.sell(ts)];
  }

  private onStopCanceled(ts: number): ExitCommand[] {
    if (this._state !== "CANCELING_STOP") {
      // The stop disappeared without our asking: the position is unprotected.
      this.stopOrderId = null;
      this.ackedQty = 0;
      this.log(ts, "stop canceled by the broker; replacing it");
      return this.syncStop();
    }
    this.stopOrderId = null;
    return this.sell(ts);
  }

  private onCancelRejected(alreadyTerminal: boolean, ts: number): ExitCommand[] {
    if (this._state !== "CANCELING_STOP") return [];
    if (!alreadyTerminal) {
      this.raise(ts, "stop cancel rejected; position not assumed flat");
      return [];
    }
    // The stop already filled or was canceled: only the broker position can tell which.
    this._state = "AWAITING_POSITION";
    this.waitingSince = ts;
    return [{ kind: "READ_POSITION", symbol: this.symbol }];
  }

  private onPositionRead(qty: number, ts: number): ExitCommand[] {
    if (this._state !== "AWAITING_POSITION") return [];
    if (!(qty > 0)) {
      this._state = "CLOSED";
      this.soldQty = this.filledQty;
      this.log(ts, "broker position is flat; no sell sent");
      return [];
    }
    this.stopOrderId = null;
    return this.sell(ts, qty);
  }

  private sell(ts: number, qty: number = this.remainingQty): ExitCommand[] {
    if (!(qty > 0) || this.exitReason === null) {
      this.raise(ts, "exit requested with no quantity to sell");
      return [];
    }
    this._state = "SELLING";
    this.waitingSince = ts;
    this.sellSeq += 1;
    return [{ kind: "MARKET_SELL", clientOrderId: `${this.positionId}:exit:${this.sellSeq}`, symbol: this.symbol, qty, reason: this.exitReason }];
  }

  private onSellFilled(qty: number, ts: number): ExitCommand[] {
    if (this._state !== "SELLING") return [];
    this.soldQty += qty;
    if (this.remainingQty > 0) return []; // partial; wait for the rest or the timeout
    this._state = "CLOSED";
    this.log(ts, `closed by ${this.exitReason}`);
    return [];
  }

  private onSellRejected(reason: string, heldQty: boolean, ts: number): ExitCommand[] {
    if (this._state !== "SELLING") return [];
    if (heldQty && !this.sellRetried) {
      // Recipe step 4e: re-read the broker position, retry once.
      this.sellRetried = true;
      this._state = "AWAITING_POSITION";
      this.waitingSince = ts;
      return [{ kind: "READ_POSITION", symbol: this.symbol }];
    }
    this.raise(ts, `market sell rejected (${reason}); position not assumed flat`);
    return [];
  }

  // ------------------------------------------------------------------
  // Exceptions
  // ------------------------------------------------------------------

  private log(ts: number, reason: string): void {
    this._notes.push({ ts, reason });
  }

  /** Records an exception; with `terminal` the machine stops and the position stays "not flat". */
  private raise(ts: number, reason: string, terminal = true): void {
    this._exceptions.push({ ts, reason });
    if (terminal) this._state = "EXCEPTION";
  }

  private nextStopId(): string {
    this.stopSeq += 1;
    return `${this.positionId}:stop:${this.stopSeq}`;
  }

  /** Whether the symbol has been reported halted (informational for callers). */
  get isHalted(): boolean {
    return this.halted;
  }
}

/**
 * Registry of the open positions' machines. Gives the daily halt (P2-4) one
 * call that cancels pending entries and liquidates everything through the
 * machines, so liquidation cannot bypass the no-duplicate-sell rules.
 */
export class ExitStateMachineRegistry {
  private readonly machines = new Map<string, ExitStateMachine>();

  add(machine: ExitStateMachine): void {
    if (this.machines.has(machine.positionId)) throw new Error(`Duplicate exit machine for ${machine.positionId}`);
    this.machines.set(machine.positionId, machine);
  }

  get(positionId: string): ExitStateMachine | undefined {
    return this.machines.get(positionId);
  }

  /** Machines that are not yet confirmed flat. */
  open(): ExitStateMachine[] {
    return [...this.machines.values()].filter((m) => !m.isFlat);
  }

  /**
   * Requests an emergency exit for every open position, in insertion order.
   * Idempotent: `eventId` makes a replay of the same request a no-op.
   */
  liquidateAll(eventId: string, ts: number): Array<{ positionId: string; commands: ExitCommand[] }> {
    const out: Array<{ positionId: string; commands: ExitCommand[] }> = [];
    for (const m of this.open()) {
      out.push({ positionId: m.positionId, commands: m.handle({ type: "EMERGENCY", eventId: `${eventId}:${m.positionId}`, ts }) });
    }
    return out;
  }
}
