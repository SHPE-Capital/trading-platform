/**
 * core/backtest/backtestWorker.ts
 *
 * Executes queued backtests (Part 02). A worker claims one job at a time,
 * heartbeats its lease while the engine runs, stages the result, and marks the
 * job succeeded — or failed, with the engine's error message.
 *
 * One job per process, deliberately: BacktestEngine installs a process-global
 * simulated clock for the length of a run, so two concurrent runs in one
 * process would read each other's time. Scale by running more workers.
 *
 * Lease loss (this worker stalled past its lease and another reclaimed the job)
 * aborts the run at the engine's next yield point and writes nothing.
 */

import { logger } from "../../utils/logger";
import type { BacktestEngine } from "./backtestEngine";
import type { BacktestResult } from "../../types/backtest";
import type { IStrategy } from "../../strategies/base/strategy";
import type { BacktestConfig } from "../../types/backtest";
import type { BacktestJob, BacktestJobProgress } from "../../types/backtestJob";

export interface BacktestJobQueue {
  claim(workerId: string): Promise<BacktestJob | null>;
  touch(jobId: string, workerId: string, progress: BacktestJobProgress | null): Promise<boolean>;
  writeArtifacts(jobId: string, result: BacktestResult): Promise<void>;
  complete(jobId: string, workerId: string): Promise<boolean>;
  fail(jobId: string, workerId: string, message: string): Promise<boolean>;
  release(jobId: string, workerId: string): Promise<boolean>;
  sweep(): Promise<number>;
}

export interface BacktestWorkerOptions {
  /** How often the lease is extended while a job runs. Must be well under the lease length. */
  heartbeatMs: number;
  /** Minimum gap between progress writes. */
  progressMs: number;
  /** Idle wait between claim attempts when the queue is empty. */
  pollMs: number;
  /** How often expired staged results and old jobs are swept. */
  sweepMs: number;
}

export const DEFAULT_WORKER_OPTIONS: BacktestWorkerOptions = {
  heartbeatMs: 15_000,
  progressMs: 1_000,
  pollMs: 2_000,
  sweepMs: 5 * 60_000,
};

class LeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Lease on backtest job ${jobId} was lost — another worker reclaimed it`);
    this.name = "LeaseLostError";
  }
}

class ShutdownError extends Error {
  constructor() {
    super("Worker shutting down");
    this.name = "ShutdownError";
  }
}

export class BacktestWorker {
  private stopping = false;
  private currentAbort: AbortController | null = null;
  private loopPromise: Promise<void> | null = null;
  private lastSweepAt = 0;
  private wakeIdle: (() => void) | null = null;

  constructor(
    readonly workerId: string,
    private readonly queue: BacktestJobQueue,
    private readonly createEngine: () => BacktestEngine,
    private readonly buildStrategies: (config: BacktestConfig) => IStrategy[],
    private readonly options: BacktestWorkerOptions = DEFAULT_WORKER_OPTIONS,
  ) {}

  /** Starts the claim loop. Resolves when stop() completes. */
  start(): Promise<void> {
    if (!this.loopPromise) this.loopPromise = this.loop();
    return this.loopPromise;
  }

  /**
   * Stops claiming. A job in flight is aborted and handed back to the queue
   * immediately rather than left to wait out its lease.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    this.currentAbort?.abort(new ShutdownError());
    this.wakeIdle?.();
    await this.loopPromise;
  }

  private async loop(): Promise<void> {
    logger.info("BacktestWorker: started", { workerId: this.workerId });
    while (!this.stopping) {
      await this.maybeSweep();
      let processed = false;
      try {
        processed = await this.runOnce();
      } catch (err) {
        // Claim failures are transient (network, DB restart). Back off and retry.
        logger.error("BacktestWorker: claim cycle failed", { err: String(err) });
      }
      if (!processed && !this.stopping) await this.idle(this.options.pollMs);
    }
    logger.info("BacktestWorker: stopped", { workerId: this.workerId });
  }

  /**
   * Claims and executes at most one job.
   * @returns true when a job was claimed (whatever its outcome)
   */
  async runOnce(): Promise<boolean> {
    const job = await this.queue.claim(this.workerId);
    if (!job) return false;
    await this.execute(job);
    return true;
  }

  private async execute(job: BacktestJob): Promise<void> {
    const abort = new AbortController();
    this.currentAbort = abort;
    const loseLease = () => {
      if (!abort.signal.aborted) abort.abort(new LeaseLostError(job.id));
    };

    logger.info("BacktestWorker: claimed job", { jobId: job.id, attempt: job.attempts });

    const heartbeat = setInterval(() => {
      this.queue.touch(job.id, this.workerId, null).then(
        (held) => { if (!held) loseLease(); },
        // A failed heartbeat is not a lost lease; the next one may succeed, and
        // the lease has several heartbeats of slack before it actually lapses.
        (err) => logger.warn("BacktestWorker: heartbeat failed", { jobId: job.id, err: String(err) }),
      );
    }, this.options.heartbeatMs);

    let lastProgressAt = 0;
    let progressInFlight = false;
    const onProgress = (point: BacktestJobProgress) => {
      const now = Date.now();
      if (progressInFlight || now - lastProgressAt < this.options.progressMs) return;
      lastProgressAt = now;
      progressInFlight = true;
      this.queue
        .touch(job.id, this.workerId, point)
        .then((held) => { if (!held) loseLease(); })
        .catch((err) => logger.warn("BacktestWorker: progress write failed", { jobId: job.id, err: String(err) }))
        .finally(() => { progressInFlight = false; });
    };

    try {
      const result = await this.createEngine().run(
        job.config,
        () => this.buildStrategies(job.config),
        onProgress,
        { signal: abort.signal },
      );
      if (abort.signal.aborted) throw abort.signal.reason;

      await this.queue.writeArtifacts(job.id, result);
      const completed = await this.queue.complete(job.id, this.workerId);
      if (completed) {
        logger.info("BacktestWorker: job succeeded", { jobId: job.id });
      } else {
        // Lease lapsed between the run finishing and this write. Whoever holds
        // it now reruns and upserts the same deterministic artifacts.
        logger.warn("BacktestWorker: finished after losing the lease — result left to the new owner", { jobId: job.id });
      }
    } catch (err) {
      await this.handleFailure(job, abort, err);
    } finally {
      clearInterval(heartbeat);
      this.currentAbort = null;
    }
  }

  private async handleFailure(job: BacktestJob, abort: AbortController, err: unknown): Promise<void> {
    const reason = abort.signal.aborted ? abort.signal.reason : err;

    if (reason instanceof LeaseLostError) {
      logger.warn("BacktestWorker: abandoned job after losing its lease", { jobId: job.id });
      return;
    }
    if (reason instanceof ShutdownError) {
      const released = await this.queue.release(job.id, this.workerId).catch(() => false);
      logger.info("BacktestWorker: returned job to the queue on shutdown", { jobId: job.id, released });
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    logger.error("BacktestWorker: job failed", { jobId: job.id, error: message });
    await this.queue.fail(job.id, this.workerId, message).catch((failErr) =>
      logger.error("BacktestWorker: could not record failure — the lease will lapse and the job retry", {
        jobId: job.id, err: String(failErr),
      }),
    );
  }

  private async maybeSweep(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSweepAt < this.options.sweepMs) return;
    this.lastSweepAt = now;
    try {
      const removed = await this.queue.sweep();
      if (removed > 0) logger.info("BacktestWorker: swept expired results and old jobs", { removed });
    } catch (err) {
      logger.warn("BacktestWorker: sweep failed", { err: String(err) });
    }
  }

  private idle(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.wakeIdle = null; resolve(); }, ms);
      this.wakeIdle = () => { clearTimeout(timer); this.wakeIdle = null; resolve(); };
    });
  }
}
