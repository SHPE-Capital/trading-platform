import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A Supabase double: one Realtime channel and canned single-row reads per table. */
const fake = vi.hoisted(() => {
  const state = {
    rows: {} as Record<string, unknown>,
    onChange: null as null | ((payload: { eventType: string; new: unknown }) => void),
    onStatus: null as null | ((status: string) => void),
    removed: 0,
    filters: [] as unknown[],
  };
  const client = {
    channel: () => {
      const ch = {
        on: (_e: string, filter: unknown, cb: (payload: { eventType: string; new: unknown }) => void) => {
          state.filters.push(filter);
          state.onChange = cb;
          return ch;
        },
        subscribe: (cb: (status: string) => void) => {
          state.onStatus = cb;
          return ch;
        },
      };
      return ch;
    },
    removeChannel: async () => { state.removed++; },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state.rows[table] ?? null, error: null }) }),
      }),
    }),
  };
  return { state, client };
});

vi.mock("../../lib/supabaseClient", () => ({ requireSupabase: () => fake.client }));

import { FALLBACK_POLL_MS, watchBacktestJob } from "../../lib/watchBacktestJob";

function handlers() {
  return { onStatus: vi.fn(), onProgress: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  fake.state.rows = {};
  fake.state.onChange = null;
  fake.state.onStatus = null;
  fake.state.removed = 0;
  fake.state.filters = [];
});

afterEach(() => vi.useRealTimers());

describe("watchBacktestJob", () => {
  it("subscribes to just this job, then reads its current row once", async () => {
    fake.state.rows.backtest_jobs = { id: "job-1", status: "running", progress: { barIndex: 10, totalBars: 40 }, error_message: null };
    const h = handlers();
    watchBacktestJob("job-1", h);
    expect(fake.state.filters[0]).toMatchObject({ table: "backtest_jobs", filter: "id=eq.job-1" });

    fake.state.onStatus?.("SUBSCRIBED");
    await flush();
    expect(h.onStatus).toHaveBeenCalledWith("running");
    expect(h.onProgress).toHaveBeenCalledWith({ barIndex: 10, totalBars: 40 });
  });

  it("relays progress updates and completes exactly once", async () => {
    fake.state.rows.backtest_jobs = { id: "job-1", status: "queued", progress: null, error_message: null };
    const h = handlers();
    watchBacktestJob("job-1", h);
    fake.state.onStatus?.("SUBSCRIBED");
    await flush();

    fake.state.onChange?.({ eventType: "UPDATE", new: { id: "job-1", status: "running", progress: { barIndex: 5, totalBars: 10 } } });
    expect(h.onProgress).toHaveBeenCalledWith({ barIndex: 5, totalBars: 10 });

    fake.state.onChange?.({ eventType: "UPDATE", new: { id: "job-1", status: "succeeded", progress: null } });
    fake.state.onChange?.({ eventType: "UPDATE", new: { id: "job-1", status: "succeeded", progress: null } });
    expect(h.onComplete).toHaveBeenCalledTimes(1);
    expect(h.onComplete).toHaveBeenCalledWith("job-1");
    expect(fake.state.removed).toBe(1);
  });

  it("reports the worker's failure message", async () => {
    const h = handlers();
    watchBacktestJob("job-1", h);
    fake.state.onChange?.({ eventType: "UPDATE", new: { id: "job-1", status: "failed", error_message: "no bars" } });
    expect(h.onError).toHaveBeenCalledWith("no bars");
  });

  it("treats a swept job with a saved result as complete, and without one as missing", async () => {
    fake.state.rows.backtest_results = { id: "job-1" };
    const saved = handlers();
    watchBacktestJob("job-1", saved);
    fake.state.onStatus?.("SUBSCRIBED");
    await flush();
    expect(saved.onComplete).toHaveBeenCalledWith("job-1");

    fake.state.rows = {};
    const missing = handlers();
    watchBacktestJob("job-2", missing);
    fake.state.onStatus?.("SUBSCRIBED");
    await flush();
    expect(missing.onError).toHaveBeenCalledWith("Backtest job-2 not found");
  });

  it("falls back to reading the row on a timer when Realtime cannot connect", async () => {
    vi.useFakeTimers();
    fake.state.rows.backtest_jobs = { id: "job-1", status: "running", progress: null, error_message: null };
    const h = handlers();
    watchBacktestJob("job-1", h);
    fake.state.onStatus?.("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onStatus).toHaveBeenCalledTimes(1);

    fake.state.rows.backtest_jobs = { id: "job-1", status: "succeeded", progress: null, error_message: null };
    await vi.advanceTimersByTimeAsync(FALLBACK_POLL_MS);
    expect(h.onComplete).toHaveBeenCalledWith("job-1");
  });

  it("stops: no callbacks after the caller unsubscribes", () => {
    const h = handlers();
    const stop = watchBacktestJob("job-1", h);
    stop();
    fake.state.onChange?.({ eventType: "UPDATE", new: { id: "job-1", status: "succeeded" } });
    expect(h.onComplete).not.toHaveBeenCalled();
  });
});
