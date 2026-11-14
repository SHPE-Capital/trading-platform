/**
 * strategies/momentum/dailyHalt.ts
 *
 * Strategy-scoped daily halt (P2-4). When equity (cash plus marked positions,
 * so unrealized PnL counts) falls `haltPct` below start-of-day equity it, in
 * this order:
 *   1. stops new entries (isHalted() turns true),
 *   2. cancels pending entries that have no position yet,
 *   3. requests liquidation of every open position through the P2-3 exit
 *      state machines (so liquidation obeys the no-duplicate-sell rules).
 *
 * The existing kill switch only blocks orders; this also closes the book. The
 * trip is latched for the session and a repeated check is a no-op. `haltPct`
 * comes from config (`account.daily_halt_pct`); there is no default here.
 */

import type { ExitCommand, ExitStateMachineRegistry } from "./exitStateMachine";

export interface DailyHaltConfig {
  /** account.daily_halt_pct, e.g. 0.01 */
  haltPct: number;
  /** Equity at the start of the session */
  startEquity: number;
}

export interface DailyHaltPorts {
  /** Cancels entry orders that have not produced a position (no machine exists yet). */
  cancelPendingEntries(): void;
  registry: ExitStateMachineRegistry;
}

export interface DailyHaltTrip {
  fallPct: number;
  /** Exit commands per position, from the exit state machines, for the executor. */
  liquidations: Array<{ positionId: string; commands: ExitCommand[] }>;
}

export class DailyHalt {
  private tripped = false;
  private readonly haltPct: number;
  private readonly startEquity: number;

  constructor(
    config: DailyHaltConfig,
    private readonly ports: DailyHaltPorts,
  ) {
    if (!Number.isFinite(config.startEquity) || config.startEquity <= 0) throw new Error(`DailyHalt: startEquity must be > 0 (got ${config.startEquity})`);
    if (!Number.isFinite(config.haltPct) || config.haltPct <= 0 || config.haltPct > 1) throw new Error(`DailyHalt: haltPct must be in (0, 1] (got ${config.haltPct})`);
    this.haltPct = config.haltPct;
    this.startEquity = config.startEquity;
  }

  /** True once tripped: the entry path must not place new entries. */
  isHalted(): boolean {
    return this.tripped;
  }

  /**
   * Evaluates current equity (including unrealized PnL). Returns the trip the
   * first time the threshold is crossed, otherwise null. A non-finite equity
   * is ignored (it must not trip or un-trip anything).
   *
   * @param equity - cash + marked position value
   * @param ts - event time, used as the idempotency key for the liquidation request
   */
  onEquity(equity: number, ts: number): DailyHaltTrip | null {
    if (this.tripped || !Number.isFinite(equity)) return null;
    const fallPct = (this.startEquity - equity) / this.startEquity;
    if (fallPct < this.haltPct) return null;

    this.tripped = true; // 1. stop new entries
    this.ports.cancelPendingEntries(); // 2. cancel pending entries
    const liquidations = this.ports.registry.liquidateAll(`daily-halt:${ts}`, ts); // 3. liquidate via P2-3
    return { fallPct, liquidations };
  }
}
