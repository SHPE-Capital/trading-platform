/**
 * core/live/signalRecorder.ts
 *
 * Records every signal a run emits and what became of it — sent as an order,
 * blocked by a risk check, refused for capital, or never turned into an order —
 * so a quiet run can be diagnosed: did it not signal, or were its signals
 * blocked? Writes are batched; an outcome that arrives before its signal is
 * written travels with the insert.
 */

import { logger } from "../../utils/logger";
import type { SignalRow } from "../../adapters/supabase/analyticsRepository";
import type { StrategySignal } from "../../types/strategy";

export type SignalOutcome = "submitted" | "risk_rejected" | "capital_unavailable" | "dropped";

export interface SignalRecorderDeps {
  insert(rows: SignalRow[]): Promise<void>;
  setOutcome(id: string, outcome: SignalOutcome, reason: string | null): Promise<void>;
  brokerAccount: string | null;
  flushMs?: number;
}

export class SignalRecorder {
  private pending = new Map<string, SignalRow>();
  private outcomes: Array<{ id: string; outcome: SignalOutcome; reason: string | null }> = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: SignalRecorderDeps) {}

  start(): void {
    this.timer = setInterval(() => void this.flush(), this.deps.flushMs ?? 2_000);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  record(signalId: string, runId: string | null, ts: number, signal: StrategySignal): void {
    this.pending.set(signalId, {
      id: signalId,
      run_id: runId,
      strategy_id: signal.strategyId,
      broker_account: this.deps.brokerAccount,
      ts: new Date(ts).toISOString(),
      symbol: signal.symbol ?? null,
      direction: signal.direction ?? null,
      payload: signal,
      outcome: "pending",
      outcome_reason: null,
    });
  }

  /** The first outcome for a signal wins (a pair's legs share one signal). */
  outcome(signalId: string | undefined | null, outcome: SignalOutcome, reason: string | null = null): void {
    if (!signalId) return;
    const row = this.pending.get(signalId);
    if (row) {
      if (row.outcome === "pending") {
        row.outcome = outcome;
        row.outcome_reason = reason;
      }
      return;
    }
    this.outcomes.push({ id: signalId, outcome, reason });
  }

  async flush(): Promise<void> {
    const rows = [...this.pending.values()];
    const outcomes = this.outcomes;
    this.pending = new Map();
    this.outcomes = [];
    try {
      await this.deps.insert(rows);
      for (const o of outcomes) await this.deps.setOutcome(o.id, o.outcome, o.reason);
    } catch (err) {
      logger.warn("SignalRecorder: write failed — signals in this batch are not recorded", {
        signals: rows.length, outcomes: outcomes.length, err: String(err),
      });
    }
  }
}
