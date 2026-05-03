/**
 * core/backtest/backtestStreamManager.ts
 *
 * Bridges the background backtest simulation with SSE clients.
 * One EventEmitter per run is created when the run starts and torn down
 * shortly after it completes or errors. Multiple SSE connections (browser
 * tabs, dev tools) can subscribe to the same run concurrently.
 *
 * Inputs:  progress points emitted by BacktestEngine during simulation.
 * Outputs: SSE events forwarded to connected Express Response streams.
 */

import { EventEmitter } from "events";
import type { Response } from "express";

export interface BacktestProgressPoint {
  /** Simulated bar timestamp (Unix ms) */
  ts: number;
  /** Portfolio equity at this point */
  equity: number;
  /** Bars processed so far */
  barIndex: number;
  /** Total bars in the run */
  totalBars: number;
}

class BacktestStreamManager {
  private channels = new Map<string, EventEmitter>();

  /** Create a channel for a new run. Must be called before setImmediate fires. */
  register(id: string): void {
    if (!this.channels.has(id)) {
      const emitter = new EventEmitter();
      emitter.setMaxListeners(50); // allow many concurrent SSE subscribers
      this.channels.set(id, emitter);
    }
  }

  /** Returns true if a run channel is currently active. */
  has(id: string): boolean {
    return this.channels.has(id);
  }

  /** Emit a progress point to all subscribed SSE clients. */
  emit(id: string, point: BacktestProgressPoint): void {
    this.channels.get(id)?.emit("progress", point);
  }

  /** Signal successful completion. Channel is removed after a grace period. */
  complete(id: string): void {
    const emitter = this.channels.get(id);
    if (!emitter) return;
    emitter.emit("complete");
    setTimeout(() => this.channels.delete(id), 10_000).unref();
  }

  /** Signal a run failure. Channel is removed after a grace period. */
  error(id: string, message: string): void {
    const emitter = this.channels.get(id);
    if (!emitter) return;
    emitter.emit("run-error", message);
    setTimeout(() => this.channels.delete(id), 10_000).unref();
  }

  /**
   * Attach an SSE Response to this run's channel.
   * Sets headers, begins streaming, and returns a cleanup function to call
   * when the client disconnects.
   *
   * Returns null if no channel exists for the given id.
   */
  subscribe(id: string, res: Response): (() => void) | null {
    const emitter = this.channels.get(id);
    if (!emitter) return null;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    // Disable proxy/nginx buffering so events arrive immediately
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const onProgress = (point: BacktestProgressPoint) => {
      res.write(`event: progress\ndata: ${JSON.stringify(point)}\n\n`);
    };

    const onComplete = () => {
      res.write(`event: complete\ndata: {}\n\n`);
      res.end();
    };

    const onError = (message: string) => {
      res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
      res.end();
    };

    emitter.on("progress", onProgress);
    emitter.once("complete", onComplete);
    emitter.once("run-error", onError);

    return () => {
      emitter.off("progress", onProgress);
      emitter.off("complete", onComplete);
      emitter.off("run-error", onError);
    };
  }
}

export const backtestStreamManager = new BacktestStreamManager();
