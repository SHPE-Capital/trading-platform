/**
 * hooks/usePolling.ts
 *
 * Loads now, then again every `intervalMs` while the tab is visible. A
 * dashboard left open in a background tab would otherwise keep polling the API
 * (and, through it, Supabase) all night. Coming back to the tab refreshes at
 * once and resumes the interval. An interval of 0 or less loads once.
 */

"use client";

import { useEffect } from "react";

export function usePolling(load: () => unknown, intervalMs: number): void {
  useEffect(() => {
    queueMicrotask(() => void load());
    if (intervalMs <= 0) return;

    let interval: ReturnType<typeof setInterval> | null = null;
    const resume = () => {
      interval ??= setInterval(load, intervalMs);
    };
    const pause = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        pause();
      } else if (!interval) {
        void load();
        resume();
      }
    };

    if (document.visibilityState !== "hidden") resume();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      pause();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load, intervalMs]);
}
