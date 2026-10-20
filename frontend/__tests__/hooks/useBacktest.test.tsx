import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("../../services/backtestService", () => ({
  fetchBacktests: vi.fn(async () => []),
  fetchBacktest: vi.fn(),
  runBacktest: vi.fn(),
  saveBacktest: vi.fn(),
}));

import { useBacktest } from "../../hooks/useBacktest";
import type { BacktestJobHandlers } from "../../lib/watchBacktestJob";
import * as service from "../../services/backtestService";

const svc = vi.mocked(service);

/** Captures the handlers useBacktest passes to the Realtime job watcher. */
const watch = vi.hoisted(() => ({
  calls: [] as { jobId: string; handlers: BacktestJobHandlers; stop: ReturnType<typeof vi.fn> }[],
}));
vi.mock("../../lib/watchBacktestJob", () => ({
  watchBacktestJob: (jobId: string, handlers: BacktestJobHandlers) => {
    const stop = vi.fn();
    watch.calls.push({ jobId, handlers, stop });
    return stop;
  },
}));

const config = {
  name: "XOM/CVX",
  strategyConfig: { type: "pairs_trading" },
  startDate: "2024-01-01",
  endDate: "2024-03-01",
  initialCapital: 100_000,
  dataGranularity: "bar" as const,
  commissionPerShare: 0.005,
};
const RESULT = { id: "job-1", status: "completed", config, metrics: {}, equity_curve: [] };

beforeEach(() => {
  watch.calls = [];
  svc.fetchBacktest.mockResolvedValue(RESULT as never);
});

async function mounted() {
  const hook = renderHook(() => useBacktest());
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
}

describe("useBacktest", () => {
  it("shows a reused result immediately without watching a job", async () => {
    svc.runBacktest.mockResolvedValue({ backtestId: "saved-1", status: "succeeded", reused: true, message: "" });
    const { result } = await mounted();

    await act(() => result.current.run(config));

    expect(svc.fetchBacktest).toHaveBeenCalledWith("saved-1");
    expect(watch.calls).toHaveLength(0);
    expect(result.current.reused).toBe(true);
    expect(result.current.isRunning).toBe(false);
    expect(result.current.selectedResult).toEqual(RESULT);
  });

  it("follows a queued job through status, progress, and completion", async () => {
    svc.runBacktest.mockResolvedValue({ backtestId: "job-1", status: "queued", message: "" });
    const { result } = await mounted();

    await act(() => result.current.run(config));
    const { jobId, handlers } = watch.calls[0];
    expect(jobId).toBe("job-1");
    expect(result.current.queueStatus).toBe("queued");
    expect(result.current.queuedAt).not.toBeNull();

    act(() => handlers.onStatus?.("running"));
    expect(result.current.queueStatus).toBe("running");

    act(() => handlers.onProgress?.({ barIndex: 50, totalBars: 200 }));
    expect(result.current.progress).toEqual({ barIndex: 50, totalBars: 200, pct: 25 });

    act(() => handlers.onComplete("job-1"));
    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(svc.fetchBacktest).toHaveBeenCalledWith("job-1");
    expect(result.current.selectedResult).toEqual(RESULT);
    expect(result.current.queueStatus).toBeNull();
  });

  it("reports the worker's failure message", async () => {
    svc.runBacktest.mockResolvedValue({ backtestId: "job-1", status: "running", message: "" });
    const { result } = await mounted();

    await act(() => result.current.run(config));
    act(() => watch.calls[0].handlers.onError("No bars for XYZ"));

    expect(result.current.error).toBe("No bars for XYZ");
    expect(result.current.isRunning).toBe(false);
  });

  it("stops watching when unmounted mid-run", async () => {
    svc.runBacktest.mockResolvedValue({ backtestId: "job-1", status: "queued", message: "" });
    const hook = await mounted();
    await act(() => hook.result.current.run(config));

    hook.unmount();
    expect(watch.calls[0].stop).toHaveBeenCalled();
  });

  it("surfaces an enqueue failure", async () => {
    svc.runBacktest.mockRejectedValue(new Error("Failed to queue backtest"));
    const { result } = await mounted();

    await expect(act(() => result.current.run(config))).rejects.toThrow("Failed to queue backtest");
    expect(result.current.isRunning).toBe(false);
  });
});
