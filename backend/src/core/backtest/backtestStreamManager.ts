/**
 * core/backtest/backtestStreamManager.ts
 *
 * Relays a queued backtest's lifecycle to SSE clients. The run itself happens in
 * a worker process (Part 02), so this process learns about it the only way any
 * replica can: by reading the job row, which the worker updates with progress
 * about once a second. One poll loop per job per process, fanned out to every
 * browser tab watching it, and stopped when the last one disconnects.
 *
 * Polling the row instead of LISTEN/NOTIFY keeps the backend on the service-role
 * REST client alone, and it survives a worker handoff for free: whoever holds
 * the job next writes to the same row.
 *
 * Inputs:  job reads from backtest_jobs; saved-result existence checks.
 * Outputs: SSE events — status, progress, complete, error.
 */

import type { Response } from "express";
import { logger } from "../../utils/logger";
import type { BacktestJob, BacktestJobProgress } from "../../types/backtestJob";

/** Progress point shape the engine emits and the SSE `progress` event carries. */
export type BacktestProgressPoint = BacktestJobProgress;

export interface StreamSources {
  getJob(id: string): Promise<BacktestJob | null>;
  /** True when a saved backtest_results row exists for this id. */
  savedResultExists(id: string): Promise<boolean>;
}

interface Channel {
  subscribers: Set<Response>;
  timer: NodeJS.Timeout;
  lastProgressKey: string | null;
  lastStatus: string | null;
  polling: boolean;
}

const SSE_KEEPALIVE_MS = 25_000;

function openStream(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  // Disable proxy/nginx buffering so events arrive immediately
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

function send(res: Response, event: string, data: unknown): void {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export class BacktestStreamManager {
  private readonly channels = new Map<string, Channel>();

  constructor(
    private readonly sources: StreamSources,
    private readonly pollMs = 1_000,
  ) {}

  /**
   * Attaches an SSE response to a job. Finished jobs and saved results are
   * answered immediately; live jobs join (or start) the job's poll loop.
   * @returns a cleanup function for client disconnect, or null for an unknown id
   */
  async subscribe(id: string, res: Response): Promise<(() => void) | null> {
    const job = await this.sources.getJob(id);

    if (!job) {
      if (!(await this.sources.savedResultExists(id))) return null;
      openStream(res);
      send(res, "complete", { backtestId: id });
      res.end();
      return () => {};
    }

    openStream(res);
    if (this.deliverTerminal(job, [res])) return () => {};

    send(res, "status", { status: job.status });
    if (job.progress) send(res, "progress", job.progress);

    const keepalive = setInterval(() => {
      if (res.writableEnded) clearInterval(keepalive);
      else res.write(": heartbeat\n\n");
    }, SSE_KEEPALIVE_MS);
    keepalive.unref();

    const channel = this.channels.get(id) ?? this.openChannel(id, job);
    channel.subscribers.add(res);

    return () => {
      clearInterval(keepalive);
      this.detach(id, res);
    };
  }

  /** Number of jobs currently being polled — for tests and diagnostics. */
  activeChannels(): number {
    return this.channels.size;
  }

  private openChannel(id: string, job: BacktestJob): Channel {
    const channel: Channel = {
      subscribers: new Set(),
      timer: setInterval(() => void this.poll(id), this.pollMs),
      lastProgressKey: job.progress ? JSON.stringify(job.progress) : null,
      lastStatus: job.status,
      polling: false,
    };
    channel.timer.unref();
    this.channels.set(id, channel);
    return channel;
  }

  private async poll(id: string): Promise<void> {
    const channel = this.channels.get(id);
    if (!channel || channel.polling) return;
    channel.polling = true;
    try {
      const job = await this.sources.getJob(id);
      const subscribers = [...channel.subscribers];
      if (!job) {
        for (const res of subscribers) {
          send(res, "error", { message: "This backtest job no longer exists" });
          res.end();
        }
        this.close(id);
        return;
      }
      if (this.deliverTerminal(job, subscribers)) {
        this.close(id);
        return;
      }
      if (job.status !== channel.lastStatus) {
        channel.lastStatus = job.status;
        for (const res of subscribers) send(res, "status", { status: job.status });
      }
      const key = job.progress ? JSON.stringify(job.progress) : null;
      if (key && key !== channel.lastProgressKey) {
        channel.lastProgressKey = key;
        for (const res of subscribers) send(res, "progress", job.progress);
      }
    } catch (err) {
      // Transient read failure — the next tick retries; clients keep waiting.
      logger.warn("BacktestStreamManager: job poll failed", { id, err: String(err) });
    } finally {
      const still = this.channels.get(id);
      if (still) still.polling = false;
    }
  }

  /** Sends complete/error and ends the responses when the job is finished. */
  private deliverTerminal(job: BacktestJob, targets: Response[]): boolean {
    if (job.status === "succeeded") {
      for (const res of targets) {
        send(res, "complete", { backtestId: job.id });
        res.end();
      }
      return true;
    }
    if (job.status === "failed") {
      for (const res of targets) {
        send(res, "error", { message: job.errorMessage ?? "Backtest failed" });
        res.end();
      }
      return true;
    }
    return false;
  }

  private detach(id: string, res: Response): void {
    const channel = this.channels.get(id);
    if (!channel) return;
    channel.subscribers.delete(res);
    if (channel.subscribers.size === 0) this.close(id);
  }

  private close(id: string): void {
    const channel = this.channels.get(id);
    if (!channel) return;
    clearInterval(channel.timer);
    this.channels.delete(id);
  }
}
