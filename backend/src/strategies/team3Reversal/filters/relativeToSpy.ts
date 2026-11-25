/**
 * strategies/team3Reversal/filters/relativeToSpy.ts
 *
 * Filter: Relative to the market.  Switch: useRelativeToSpy
 * Knobs: benchmarkSymbol, rtsMinOwnShare, rtsExcludeSymbols (plus lookbackBars)
 * Origin: Alex Rivera (PR #78, aaf0815) wrote the first rule here: enter only if the
 * stock's 1-minute move in the fade direction beat 2 x |SPY's 1-minute move|. The
 * Stage 2 rspy session turned it into the specced filter below, keeping his
 * structure (benchmark bar matched by timestamp, entry blocked when SPY is missing).
 * Status: done (docs/team3/components/relative-to-spy.md).
 *
 * Idea in plain words: when the whole market moves, the move comes back less.
 * Fade only moves the stock made on its own.
 *
 * Rule (beta = 1):
 *   start  = the oldest bar of `history` (up to lookbackBars session bars before this bar)
 *   total  = stock close now / stock close at start - 1
 *   resid  = total - (SPY close now / SPY close at start - 1)
 *   enter only if |resid| / |total| >= rtsMinOwnShare.
 *   SPY must have a bar at both the start ts and this bar's ts, else block.
 *   total == 0 (or no history) blocks.  Symbols in rtsExcludeSymbols (SPY, QQQ) are never traded.
 */

import type { BarView, EntryFilter } from "./types";

const closeAt = (bars: readonly BarView[], ts: number): number | null => {
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i];
    if (b.ts > ts) continue;
    return b.ts === ts && b.close > 0 ? b.close : null;
  }
  return null;
};

export const relativeToSpyAllows: EntryFilter = ({ symbol, bar, history, barsOf, config }) => {
  if (config.rtsExcludeSymbols.includes(symbol.toUpperCase())) return false;
  const start = history[0];
  if (!start || start.close <= 0) return false;

  const benchmarkBars = barsOf(config.benchmarkSymbol);
  const spyNow = closeAt(benchmarkBars, bar.ts);
  const spyStart = closeAt(benchmarkBars, start.ts);
  // Skip the entry when the benchmark's return over the same bars is unavailable.
  if (spyNow === null || spyStart === null) return false;

  const total = bar.close / start.close - 1;
  if (total === 0) return false;
  const resid = total - (spyNow / spyStart - 1);
  return Math.abs(resid) / Math.abs(total) >= config.rtsMinOwnShare;
};
