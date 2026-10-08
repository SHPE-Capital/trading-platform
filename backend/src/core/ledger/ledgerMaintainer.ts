/**
 * core/ledger/ledgerMaintainer.ts
 *
 * Keeps a trading runtime's ledger in step with its broker: on an interval,
 * and shortly after each fill, it syncs the broker's records (Alpaca books only
 * — a sim book writes its own) and then checks for drift. Passes never overlap;
 * a request during a pass schedules one more.
 */

import { logger } from "../../utils/logger";
import { newId } from "../../utils/ids";
import { nowMs } from "../../utils/time";
import { checkDrift, type DriftRow, type DriftStore } from "./driftCheck";
import type { BrokerSyncService } from "./brokerSync";
import type { BrokerPosition, IBroker } from "../broker/IBroker";
import type { EventBus } from "../engine/eventBus";
import type { ExecutionMode } from "../../types/common";

export interface LedgerMaintainerDeps {
  broker: IBroker;
  sync: BrokerSyncService | null;
  driftStore: DriftStore;
  eventBus: EventBus;
  mode: ExecutionMode;
  intervalMs: number;
  /** Delay before a requested pass, so a burst of fills is synced once. */
  debounceMs?: number;
  /** After each pass: the broker's positions and the ledger orders the sync wrote. */
  afterPass?(positions: BrokerPosition[], touchedOrderIds: string[]): Promise<void>;
}

export class LedgerMaintainer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private soon: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private lastDriftKey = "";

  constructor(private readonly deps: LedgerMaintainerDeps) {}

  start(): void {
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.deps.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.soon) clearTimeout(this.soon);
    this.timer = null;
    this.soon = null;
  }

  /** Runs a pass shortly — after a fill, so the ledger catches up within seconds. */
  requestSoon(): void {
    if (this.soon) return;
    this.soon = setTimeout(() => {
      this.soon = null;
      void this.runOnce();
    }, this.deps.debounceMs ?? 3_000);
    this.soon.unref?.();
  }

  /** One sync + drift pass. Concurrent calls share the pass in flight and queue one more. */
  runOnce(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this._pass().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.runOnce();
      }
    });
    return this.running;
  }

  private async _pass(): Promise<void> {
    const { broker, sync, driftStore } = this.deps;
    try {
      let touched: string[] = [];
      if (sync) {
        const result = await sync.syncOnce();
        touched = result.touchedOrderIds;
        if (result.unattributedOrders > 0) {
          logger.warn("LedgerMaintainer: broker has orders no run sent", {
            account: broker.accountId, count: result.unattributedOrders,
          });
        }
      }
      const positions = await broker.getPositions();
      const rows = await checkDrift(broker.accountId, positions, driftStore);
      this._reportDrift(rows);
      await this.deps.afterPass?.(positions, touched);
    } catch (err) {
      logger.error("LedgerMaintainer: ledger pass failed", { account: broker.accountId, err: String(err) });
    }
  }

  private _reportDrift(rows: DriftRow[]): void {
    const key = JSON.stringify(rows);
    if (key === this.lastDriftKey) return;
    this.lastDriftKey = key;
    if (rows.length === 0) {
      logger.info("LedgerMaintainer: broker positions match the runs' books", { account: this.deps.broker.accountId });
    } else {
      logger.warn("LedgerMaintainer: positions not held by a running run", { account: this.deps.broker.accountId, rows });
    }
    this.deps.eventBus.publish({
      id: newId(),
      type: "BROKER_DRIFT",
      ts: nowMs(),
      mode: this.deps.mode,
      brokerAccount: this.deps.broker.accountId,
      rows,
    });
  }
}
