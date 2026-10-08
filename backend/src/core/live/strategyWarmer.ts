/**
 * core/live/strategyWarmer.ts
 *
 * Boot-time warm-up (Part 05). Every rolling window lives in memory, so without
 * this a restart leaves a strategy with a multi-day window below
 * minObservations for days — and on a shared book the whole club goes blind at
 * once. The depth comes from the strategy itself (its longest window), not a
 * hardcoded constant.
 */

import type { IStrategy } from "../../strategies/base/strategy";
import type { Bar } from "../../types/market";

export interface WarmUpOptions {
  /** Extra history beyond the strategy's window, so the oldest slot is filled too. */
  marginMs: number;
  /** Deeper than this is truncated — bounds boot time for extreme windows. */
  maxLookbackMs: number;
  /** Give up and start cold after this long. */
  timeoutMs: number;
  now: () => number;
}

export const DEFAULT_WARM_UP_OPTIONS: WarmUpOptions = {
  marginMs: 60 * 60_000,
  maxLookbackMs: 90 * 86_400_000,
  timeoutMs: 60_000,
  now: Date.now,
};

export type BarSource = (symbols: string[], startIso: string, endIso: string) => Promise<Bar[]>;

/**
 * Loads the strategy's lookback of 1-minute bars and replays them through
 * strategy.warmUp(). Strategies without warm-up support are a no-op.
 * @returns observations primed
 */
export async function warmUpStrategy(
  strategy: IStrategy,
  loadBars: BarSource,
  options: WarmUpOptions = DEFAULT_WARM_UP_OPTIONS,
): Promise<number> {
  if (!strategy.warmUp || !strategy.warmUpLookbackMs) return 0;
  const lookback = Math.min(strategy.warmUpLookbackMs(), options.maxLookbackMs);
  if (!(lookback > 0)) return 0;

  const end = options.now();
  const start = end - lookback - options.marginMs;

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`warm-up timed out after ${options.timeoutMs}ms`)), options.timeoutMs);
  });
  try {
    const bars = await Promise.race([
      loadBars(strategy.config.symbols, new Date(start).toISOString(), new Date(end).toISOString()),
      timeout,
    ]);
    return strategy.warmUp(bars);
  } finally {
    clearTimeout(timer);
  }
}
