/**
 * strategies/team3Reversal/history.ts
 *
 * What the strategy remembers: today's regular-session bars and session VWAP,
 * per symbol. Pre-market, after-hours and yesterday never enter (bugs 1, 2):
 *   - the "previous bar" is always the previous session bar of the same day,
 *     so the 9:30 bar is never compared to an overnight close;
 *   - every return (for sigma) is between two bars of the same session.
 *
 * ingest() is idempotent per bar timestamp, so the strategy can feed every
 * symbol's latest bar on every call (same-minute cross-section, see CONTRACT.md).
 *
 * Owner: team lead. Pure: no platform imports.
 */

import type { BarView, VwapView } from "./filters/types";
import { inRegularSession, newYorkDay } from "./session";
import { SessionVwapTracker } from "./vwap";

interface SymbolDay {
  day: string;
  bars: BarView[];
  vwap: SessionVwapTracker;
}

export class SessionHistory {
  private readonly symbols = new Map<string, SymbolDay>();

  /** Adds a bar if it is a new regular-session bar. Returns true only when it was added. */
  ingest(symbol: string, bar: BarView): boolean {
    if (!inRegularSession(bar.ts)) return false;
    const day = newYorkDay(bar.ts);
    let s = this.symbols.get(symbol);
    if (!s || s.day !== day) {
      s = { day, bars: [], vwap: new SessionVwapTracker() };   // new day: forget yesterday
      this.symbols.set(symbol, s);
    }
    const last = s.bars[s.bars.length - 1];
    if (last && bar.ts <= last.ts) return false;                // already seen
    s.bars.push(bar);
    s.vwap.update(bar);
    return true;
  }

  /** Today's session bars for a symbol, oldest first (the latest ingested bar last). */
  today(symbol: string): readonly BarView[] {
    return this.symbols.get(symbol)?.bars ?? [];
  }

  /** Today's VWAP picture for a symbol, or null before any session volume. */
  vwap(symbol: string, windowBars: number): VwapView | null {
    return this.symbols.get(symbol)?.vwap.view(windowBars) ?? null;
  }
}
