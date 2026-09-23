/**
 * core/live/riskRejectionRecorder.ts
 *
 * Persists the live book's blocked orders to risk_rejections (Part 06). A
 * blocked strategy can be rejected on every bar, so rows are buffered and
 * written in batches; owner lookups are cached. The trading path only ever
 * appends to an in-memory array — a slow or unreachable database cannot stall
 * it, and a prolonged outage drops the oldest rows rather than growing memory.
 */

import { logger } from "../../utils/logger";
import type { RiskRejectionRow } from "../../adapters/supabase/riskRejectionRepository";

export interface RejectionInput {
  ts: number;
  strategyId: string | null;
  symbol: string | null;
  failedCheck: string;
  reason: string | null;
  intent: unknown;
}

export interface RiskRejectionRecorderDeps {
  insert(rows: RiskRejectionRow[]): Promise<void>;
  resolveOwner(strategyId: string): Promise<string | null>;
  now?: () => number;
}

export interface RiskRejectionRecorderOptions {
  flushMs: number;
  maxBuffered: number;
  ownerCacheMs: number;
}

const DEFAULTS: RiskRejectionRecorderOptions = {
  flushMs: 5_000,
  maxBuffered: 5_000,
  ownerCacheMs: 5 * 60_000,
};

export class RiskRejectionRecorder {
  private pending: RejectionInput[] = [];
  private flushing: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private dropped = 0;
  private readonly owners = new Map<string, { owner: string | null; at: number }>();
  private readonly options: RiskRejectionRecorderOptions;
  private readonly now: () => number;

  constructor(private readonly deps: RiskRejectionRecorderDeps, options: Partial<RiskRejectionRecorderOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.now = deps.now ?? Date.now;
  }

  record(rejection: RejectionInput): void {
    this.pending.push(rejection);
    if (this.pending.length > this.options.maxBuffered) {
      const overflow = this.pending.length - this.options.maxBuffered;
      this.pending.splice(0, overflow);
      this.dropped += overflow;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.options.flushMs);
    this.timer.unref();
  }

  /** Stops the timer and writes whatever is buffered. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  /** Writes the buffered rejections. Concurrent calls share one write. */
  flush(): Promise<void> {
    if (!this.flushing) {
      this.flushing = this.doFlush().finally(() => { this.flushing = null; });
    }
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    if (this.dropped > 0) {
      logger.warn("RiskRejectionRecorder: dropped rejections while the database was unreachable", { dropped: this.dropped });
      this.dropped = 0;
    }
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];

    try {
      const rows: RiskRejectionRow[] = [];
      for (const r of batch) {
        rows.push({
          ts: new Date(r.ts).toISOString(),
          strategy_id: r.strategyId,
          owner_id: r.strategyId ? await this.ownerOf(r.strategyId) : null,
          symbol: r.symbol,
          failed_check: r.failedCheck,
          reason: r.reason,
          intent: r.intent ?? null,
        });
      }
      await this.deps.insert(rows);
    } catch (err) {
      logger.warn("RiskRejectionRecorder: write failed — will retry", { count: batch.length, err: String(err) });
      // Put the batch back in front of anything recorded meanwhile, within the cap.
      this.pending = [...batch, ...this.pending];
      if (this.pending.length > this.options.maxBuffered) {
        const overflow = this.pending.length - this.options.maxBuffered;
        this.pending.splice(0, overflow);
        this.dropped += overflow;
      }
    }
  }

  private async ownerOf(strategyId: string): Promise<string | null> {
    const cached = this.owners.get(strategyId);
    if (cached && this.now() - cached.at < this.options.ownerCacheMs) return cached.owner;
    const owner = await this.deps.resolveOwner(strategyId).catch(() => null);
    this.owners.set(strategyId, { owner, at: this.now() });
    return owner;
  }
}
