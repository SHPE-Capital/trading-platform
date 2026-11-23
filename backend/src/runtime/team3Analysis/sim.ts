/**
 * runtime/team3Analysis/sim.ts
 *
 * S4 strategy survey (offline, no backtests): rebuild the V4 session picture from a
 * dump's bars and simulate the baseline exit from any entry bar.
 *
 * Reuses the strategy's own pieces so VWAP, z, crossings, session windows and exit
 * reasons are exactly the engine's: SessionVwapTracker (vwap.ts), inRegularSession /
 * newYorkDay (session.ts), sessionWindow / exitReason (rules.ts).
 *
 * Engine timing reproduced (contract/book.ts):
 *   signal on bar i  -> fill at the symbol's next bar open (raw bar i+1, any session)
 *   bar i+k          -> barsHeld = k, exit reason checked on bar i+k's close
 *   exit signal at e -> V4's pnlBpsGross = close[e] vs the fill (signal level);
 *                       the engine's exit fill is the next raw bar's open.
 * Owner: team lead. Pure: no I/O.
 */

import { SessionVwapTracker } from "../../strategies/team3Reversal/vwap";
import { inRegularSession, minutesSinceOpen, newYorkDay } from "../../strategies/team3Reversal/session";
import { exitReason, sessionWindow, type SessionWindow } from "../../strategies/team3Reversal/rules";

export type RawBar = [number, number, number, number, number, number]; // ts, o, h, l, c, v

export interface SessionSeries {
  symbol: string;
  n: number;
  ts: number[]; open: number[]; high: number[]; low: number[]; close: number[]; volume: number[];
  vwap: number[]; sigma: number[];
  /** NaN while sigma is 0. */
  z: number[];
  crossings: number[];
  day: string[];
  /** Index of the first session bar of this bar's day. */
  dayStart: number[];
  minuteOfSession: number[];
  window: SessionWindow[];
  /** Open of the symbol's next raw bar (any session), NaN if none: where an order sent on this bar fills. */
  nextOpen: number[];
  /** ts -> session index. */
  index: Map<number, number>;
}

export interface WindowCfg { skipOpenMinutes: number; lastEntryMinutesBeforeClose: number; flattenMinutesBeforeClose: number }
export interface ExitCfg { stopZ: number; maxHoldBars: number }

export const V4_WINDOW: WindowCfg = { skipOpenMinutes: 15, lastEntryMinutesBeforeClose: 15, flattenMinutesBeforeClose: 5 };
export const V4_EXIT: ExitCfg = { stopZ: 3.5, maxHoldBars: 30 };

/** Builds one symbol's regular-session series with the engine's VWAP picture after every bar. */
export function buildSeries(symbol: string, raw: readonly RawBar[], win: WindowCfg = V4_WINDOW, vwapWindowBars = 60): SessionSeries {
  const s: SessionSeries = {
    symbol, n: 0, ts: [], open: [], high: [], low: [], close: [], volume: [], vwap: [], sigma: [], z: [], crossings: [],
    day: [], dayStart: [], minuteOfSession: [], window: [], nextOpen: [], index: new Map(),
  };
  const tracker = new SessionVwapTracker();
  let curDay = "", start = 0, lastTs = -Infinity;
  for (let r = 0; r < raw.length; r++) {
    const [ts, o, h, l, c, v] = raw[r];
    if (ts <= lastTs || !inRegularSession(ts)) continue;
    lastTs = ts;
    const day = newYorkDay(ts);
    if (day !== curDay) { curDay = day; start = s.n; }
    tracker.update({ ts, open: o, high: h, low: l, close: c, volume: v });
    const view = tracker.view(vwapWindowBars);
    s.ts.push(ts); s.open.push(o); s.high.push(h); s.low.push(l); s.close.push(c); s.volume.push(v);
    s.vwap.push(view ? view.vwap : NaN); s.sigma.push(view ? view.sigma : NaN);
    s.z.push(view && view.z !== null ? view.z : NaN); s.crossings.push(view ? view.crossings : 0);
    s.day.push(day); s.dayStart.push(start); s.minuteOfSession.push(minutesSinceOpen(ts));
    s.window.push(sessionWindow(ts, win));
    s.nextOpen.push(r + 1 < raw.length ? raw[r + 1][1] : NaN);
    s.index.set(ts, s.n);
    s.n += 1;
  }
  return s;
}

export type Reason = "close" | "stop" | "target" | "time";

export interface SimTrade {
  entryIdx: number;
  exitIdx: number;
  reason: Reason;
  barsHeld: number;
  fill: number;
  /** close[exit] vs fill: V4's pnlBpsGross definition. */
  grossCloseBps: number;
  /** next raw open after the exit signal vs fill: what the engine's zero-cost fills earn. */
  grossFillBps: number;
}

/** Baseline exit for a position signalled on session bar i (side +1 long, -1 short). null if it can't fill today. */
export function simulateExit(s: SessionSeries, i: number, sign: 1 | -1, cfg: ExitCfg = V4_EXIT): SimTrade | null {
  const fill = s.nextOpen[i];
  if (!(fill > 0) || i + 1 >= s.n || s.day[i + 1] !== s.day[i]) return null;
  const c = { ...cfg, usePartwayTarget: false, useScaleOut: false, tpFraction: 0.5 };
  for (let k = i + 1; k < s.n && s.day[k] === s.day[i]; k++) {
    const z = Number.isNaN(s.z[k]) ? null : s.z[k];
    const reason = exitReason({ qty: sign, barsHeld: k - i, fromEarlierDay: false }, s.window[k], z, c);
    if (reason) {
      const exitFill = s.nextOpen[k] > 0 ? s.nextOpen[k] : s.close[k];
      return {
        entryIdx: i, exitIdx: k, reason: reason as Reason, barsHeld: k - i, fill,
        grossCloseBps: (sign * (s.close[k] - fill) / fill) * 10_000,
        grossFillBps: (sign * (exitFill - fill) / fill) * 10_000,
      };
    }
  }
  return null;
}

/** V4's default entry rule on bar i (no filters): fade the bar's move, entryZ <= |z| < stopZ same side, edge >= minEdgeBps. */
export function v4Entry(s: SessionSeries, i: number, entryZ = 2, minEdgeBps = 15, stopZ = 3.5): 1 | -1 | 0 {
  if (s.window[i] !== "open" || i === s.dayStart[i] || Number.isNaN(s.z[i])) return 0;
  const prev = s.close[i - 1], c = s.close[i], z = s.z[i];
  if (c === prev) return 0;
  const sign: 1 | -1 = c > prev ? -1 : 1;
  const stretched = (sign === -1 ? z >= entryZ : z <= -entryZ) && Math.abs(z) < stopZ;
  return stretched && edgeBps(s, i) >= minEdgeBps ? sign : 0;
}

export const edgeBps = (s: SessionSeries, i: number): number => (Math.abs(s.close[i] - s.vwap[i]) / s.close[i]) * 10_000;

/** Opportunity rule (set b): entry window, minZ <= |z| < stopZ, side fades the stretch. */
export function isOpportunity(s: SessionSeries, i: number, minZ = 1.5, stopZ = 3.5): 1 | -1 | 0 {
  const z = s.z[i];
  if (s.window[i] !== "open" || i === s.dayStart[i] || Number.isNaN(z)) return 0;
  const a = Math.abs(z);
  return a >= minZ && a < stopZ ? (z > 0 ? -1 : 1) : 0;
}
