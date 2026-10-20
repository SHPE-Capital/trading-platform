import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePolling } from "../../hooks/usePolling";

/** Flips the tab's visibility the way a browser does: new state, then the event. */
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  // Drop the override so jsdom's own (always visible) getter shows through again.
  delete (document as { visibilityState?: unknown }).visibilityState;
});

describe("usePolling", () => {
  it("loads at once, then on every interval while the tab is visible", async () => {
    const load = vi.fn();
    renderHook(() => usePolling(load, 1_000));

    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("stops while the tab is hidden and refreshes as soon as it is back", async () => {
    const load = vi.fn();
    renderHook(() => usePolling(load, 1_000));
    await vi.advanceTimersByTimeAsync(0);

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(load).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("loads once and never polls when the interval is 0", async () => {
    const load = vi.fn();
    renderHook(() => usePolling(load, 0));

    await vi.advanceTimersByTimeAsync(10_000);
    setVisibility("hidden");
    setVisibility("visible");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("stops polling and listening once unmounted", async () => {
    const load = vi.fn();
    const { unmount } = renderHook(() => usePolling(load, 1_000));
    await vi.advanceTimersByTimeAsync(0);
    unmount();

    await vi.advanceTimersByTimeAsync(5_000);
    setVisibility("hidden");
    setVisibility("visible");
    expect(load).toHaveBeenCalledTimes(1);
  });
});
