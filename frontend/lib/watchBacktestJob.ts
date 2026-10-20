/**
 * lib/watchBacktestJob.ts
 *
 * Follows one queued backtest through Supabase Realtime instead of a server
 * stream that re-read the job row every second for every open page. The
 * worker's own writes (status, ~1/s progress) arrive as postgres_changes on
 * backtest_jobs (0019 publishes it; RLS limits it to active members).
 *
 * Subscribes first, then reads the row once, so an update landing between the
 * two is never missed. If Realtime cannot connect, it falls back to reading the
 * row every few seconds. Exactly one of onComplete / onError fires, once.
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import { requireSupabase } from "./supabaseClient";

export interface JobProgress {
  barIndex: number;
  totalBars: number;
}

export interface BacktestJobHandlers {
  onStatus?: (status: "queued" | "running") => void;
  onProgress?: (progress: JobProgress) => void;
  /** The job succeeded; its result is stored under `backtestId`. */
  onComplete: (backtestId: string) => void;
  onError: (message: string) => void;
}

type JobRow = { id: string; status: string; progress: unknown; error_message: string | null };

export const FALLBACK_POLL_MS = 5_000;

/** Starts watching; returns a function that stops it. */
export function watchBacktestJob(jobId: string, handlers: BacktestJobHandlers): () => void {
  const supabase = requireSupabase();
  let done = false;
  let channel: RealtimeChannel | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    done = true;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (channel) void supabase.removeChannel(channel);
    channel = null;
  };

  const finish = (fn: () => void) => {
    if (done) return;
    stop();
    fn();
  };

  const apply = (row: JobRow) => {
    if (done) return;
    if (row.status === "succeeded") return finish(() => handlers.onComplete(row.id));
    if (row.status === "failed") return finish(() => handlers.onError(row.error_message ?? "Backtest failed"));
    if (row.status === "queued" || row.status === "running") handlers.onStatus?.(row.status);
    const p = row.progress as Partial<JobProgress> | null;
    if (p && typeof p.barIndex === "number" && typeof p.totalBars === "number" && p.totalBars > 0) {
      handlers.onProgress?.({ barIndex: p.barIndex, totalBars: p.totalBars });
    }
  };

  const readOnce = async () => {
    const { data, error } = await supabase
      .from("backtest_jobs").select("id, status, progress, error_message").eq("id", jobId).maybeSingle();
    if (done) return;
    if (error) return finish(() => handlers.onError(`Could not read the backtest job: ${error.message}`));
    if (data) return apply(data as JobRow);
    // No job row: it was swept after finishing. A saved result means it succeeded.
    const saved = await supabase.from("backtest_results").select("id").eq("id", jobId).maybeSingle();
    if (saved.data) finish(() => handlers.onComplete(jobId));
    else finish(() => handlers.onError(`Backtest ${jobId} not found`));
  };

  const fallBackToPolling = () => {
    if (done || pollTimer) return;
    if (channel) void supabase.removeChannel(channel);
    channel = null;
    pollTimer = setInterval(() => void readOnce(), FALLBACK_POLL_MS);
    void readOnce();
  };

  channel = supabase
    .channel(`backtest-job-${jobId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "backtest_jobs", filter: `id=eq.${jobId}` },
      (payload) => {
        if (payload.eventType === "DELETE") void readOnce();
        else apply(payload.new as JobRow);
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") void readOnce();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") fallBackToPolling();
    });

  return stop;
}
