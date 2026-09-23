import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("../../services/backtestService", () => ({
  fetchBacktests: vi.fn(async () => []),
  fetchBacktest: vi.fn(),
  runBacktest: vi.fn(),
  saveBacktest: vi.fn(),
}));

import { useBacktest } from "../../hooks/useBacktest";
import * as service from "../../services/backtestService";

const svc = vi.mocked(service);

/** Minimal EventSource double: tests push named events into it. */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.OPEN;
  private listeners = new Map<string, ((e: Event) => void)[]>();
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, fn: (e: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() { this.readyState = FakeEventSource.CLOSED; }
  emit(type: string, data?: unknown) {
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data: JSON.stringify(data) });
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
}

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
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  svc.fetchBacktest.mockResolvedValue(RESULT as never);
});
afterEach(() => vi.unstubAllGlobals());

async function mounted() {
  const hook = renderHook(() => useBacktest());
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
}

describe("useBacktest", () => {
  it("shows a reused result immediately without opening a progress stream", async () => {
    svc.runBacktest.mockResolvedValue({ backtestId: "saved-1", status: "succeeded", reused: true, message: "" });
    const { result } = await mounted();

    await act(() => result.current.run(config));

    expect(svc.fetchBacktest).toHaveBeenCalledWith("saved-1");
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current.reused).toBe(true);
    expect(result.current.isRunning).toBe(false);
    expect(result.current.selectedResult).toEqual(RESULT);
  });

  it("follows a queued job through status, progress, and completion", async () => {
    svc.runBacktest.mockResolvedValue({ backtestId: "job-1", status: "queued", message: "" });
    const { result } = await mounted();

    await act(() => result.current.run(config));
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe("http://backtest.test/api/backtests/job-1/stream");
    expect(result.current.queueStatus).toBe("queued");
    expect(result.current.queuedAt).not.toBeNull();

    act(() => es.emit("status", { status: "running" }));
    expect(result.current.queueStatus).toBe("running");

    act(() => es.emit("progress", { barIndex: 50, totalBars: 200, ts: 1, equity: 1 }));
    expect(result.current.progress).toEqual({ barIndex: 50, totalBars: 200, pct: 25 });

    act(() => es.emit("complete", { backtestId: "job-1" }));
    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(result.current.selectedResult).toEqual(RESULT);
    expect(result.current.queueStatus).toBeNull();
    expect(es.readyState).toBe(FakeEventSource.CLOSED);
  });

  it("reports the worker's failure message", async () => {
    svc.runBacktest.mockResolvedValue({ backtestId: "job-1", status: "running", message: "" });
    const { result } = await mounted();

    await act(() => result.current.run(config));
    act(() => FakeEventSource.instances[0].emit("error", { message: "No bars for XYZ" }));

    expect(result.current.error).toBe("No bars for XYZ");
    expect(result.current.isRunning).toBe(false);
  });

  it("lets the browser reconnect after a dropped connection, and only gives up once it is closed", async () => {
    svc.runBacktest.mockResolvedValue({ backtestId: "job-1", status: "queued", message: "" });
    const { result } = await mounted();
    await act(() => result.current.run(config));
    const es = FakeEventSource.instances[0];

    act(() => es.emit("error")); // transient: still OPEN/CONNECTING
    expect(result.current.isRunning).toBe(true);
    expect(result.current.error).toBeNull();

    es.readyState = FakeEventSource.CLOSED;
    act(() => es.emit("error"));
    expect(result.current.error).toMatch(/Lost the connection/);
    expect(result.current.isRunning).toBe(false);
  });

  it("surfaces an enqueue failure", async () => {
    svc.runBacktest.mockRejectedValue(new Error("Failed to queue backtest"));
    const { result } = await mounted();

    await expect(act(() => result.current.run(config))).rejects.toThrow("Failed to queue backtest");
    expect(result.current.isRunning).toBe(false);
  });
});
