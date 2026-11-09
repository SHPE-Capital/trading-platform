/**
 * tests/strategy/team3Reversal/helpers.ts
 *
 * Fake bars and filter inputs for Team 3's filter tests, so each test only
 * says what is special about its case.
 */

import { createTeam3ReversalConfig, type Team3ReversalConfig } from '../../../strategies/team3Reversal/team3ReversalConfig';
import type { BarView, EntryInput, ExitInput } from '../../../strategies/team3Reversal/filters/types';

export const MINUTE = 60_000;
/** Tue 2026-10-06 12:00 ET, mid-session. */
export const NOON_ET = Date.UTC(2026, 9, 6, 16, 0);
/** The 9:30 ET bar on the same day. */
export const OPEN_ET = Date.UTC(2026, 9, 6, 13, 30);

/** One bar at `minute` minutes after `start`, with the given close and volume. */
export function fakeBar(minute: number, close: number, volume = 1_000, start = NOON_ET): BarView {
  return { ts: start + minute * MINUTE, open: close, high: close, low: close, close, volume };
}

/** Bars with these closes, one per minute, ending right before minute 0. */
export function fakeHistory(closes: number[], volume = 1_000, start = NOON_ET): BarView[] {
  return closes.map((c, i) => fakeBar(i - closes.length, c, volume, start));
}

/**
 * An entry-filter input: `history` closes, then `bar`. move and side are
 * worked out from the last history close, the way the strategy does it.
 */
export function entryInput(opts: {
  history: BarView[];
  bar: BarView;
  symbol?: string;
  others?: Record<string, BarView[]>;
  config?: Partial<Team3ReversalConfig>;
}): EntryInput {
  const prev = opts.history[opts.history.length - 1];
  const move = (opts.bar.close - prev.close) / prev.close;
  return {
    symbol: opts.symbol ?? 'AAPL',
    bar: opts.bar,
    history: opts.history,
    move,
    side: move > 0 ? 'sell' : 'buy',
    barsOf: (s) => opts.others?.[s] ?? [],
    config: createTeam3ReversalConfig({ id: 'test', ...opts.config }),
  };
}

/** An exit-rule input for a position entered at `entryPrice` and held `barsHeld` bars. */
export function exitInput(opts: {
  history: BarView[];
  bar: BarView;
  entryPrice: number;
  barsHeld: number;
  positionQty?: number;
  config?: Partial<Team3ReversalConfig>;
}): ExitInput {
  return {
    symbol: 'AAPL',
    bar: opts.bar,
    history: opts.history,
    positionQty: opts.positionQty ?? -1,
    entryPrice: opts.entryPrice,
    barsHeld: opts.barsHeld,
    barsOf: () => [],
    config: createTeam3ReversalConfig({ id: 'test', ...opts.config }),
  };
}
