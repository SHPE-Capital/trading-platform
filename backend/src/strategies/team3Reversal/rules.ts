/**
 * strategies/team3Reversal/rules.ts
 *
 * The baseline's trading rules, as small pure functions:
 *   sessionWindow  when in the day we may enter, must stop entering, or must flatten
 *   entryIdea      fade a bar that leaves price stretched from VWAP, if the edge beats costs
 *   exitReason     why to close a held position now (stale, close, stop, target, time)
 *
 * Docs: docs/team3/components/baseline.md
 * Owner: team lead. Pure: no platform imports.
 */

import type { Team3ReversalConfig } from "./team3ReversalConfig";
import type { BarView, VwapView } from "./filters/types";
import { minutesSinceOpen, minutesUntilClose } from "./session";

export type Side = "buy" | "sell";
export type SessionWindow = "warmup" | "open" | "no_entries" | "flatten";
export type ExitReason = "stale" | "close" | "stop" | "target" | "partway" | "time";

type WindowKnobs = Pick<Team3ReversalConfig, "skipOpenMinutes" | "lastEntryMinutesBeforeClose" | "flattenMinutesBeforeClose">;
type EntryKnobs = Pick<Team3ReversalConfig, "entryZ" | "minEdgeBps" | "stopZ"> & Partial<Pick<Team3ReversalConfig, "useTurnEntry">>;
type ExitKnobs = Pick<Team3ReversalConfig, "stopZ" | "maxHoldBars" | "usePartwayTarget" | "useScaleOut" | "tpFraction">;

type CostKnobs = Pick<Team3ReversalConfig, "captureShare" | "costFixedBps" | "costCommissionPerShare">;

/** Modeled round-trip cost in bps at this price: fixed slippage + spread, plus commission on both legs. */
export function roundTripCostBps(price: number, c: CostKnobs): number {
  return c.costFixedBps + ((2 * c.costCommissionPerShare) / price) * 10_000;
}

/** Cost-aware gate (R3): the part of the stretch we expect to capture must beat the round trip. */
export function costGate(edgeBps: number, price: number, c: CostKnobs): boolean {
  return c.captureShare * edgeBps > roundTripCostBps(price, c);
}

type CostKnobs = Pick<Team3ReversalConfig, "captureShare" | "costFixedBps" | "costCommissionPerShare">;

/** Modeled round-trip cost in bps at this price: fixed slippage + spread, plus commission on both legs. */
export function roundTripCostBps(price: number, c: CostKnobs): number {
  return c.costFixedBps + ((2 * c.costCommissionPerShare) / price) * 10_000;
}

/** Cost-aware gate (R3): the part of the stretch we expect to capture must beat the round trip. */
export function costGate(edgeBps: number, price: number, c: CostKnobs): boolean {
  return c.captureShare * edgeBps > roundTripCostBps(price, c);
}

/** Where a session bar sits in the trading day. Exits are allowed in every window. */
export function sessionWindow(barTs: number, c: WindowKnobs): SessionWindow {
  const left = minutesUntilClose(barTs);
  if (left <= c.flattenMinutesBeforeClose) return "flatten";
  if (left <= c.lastEntryMinutesBeforeClose) return "no_entries";
  if (minutesSinceOpen(barTs) < c.skipOpenMinutes) return "warmup";
  return "open";
}

export interface EntryIdea {
  side: Side;
  /** Fractional move of this bar's close versus the previous session close. */
  move: number;
  /** (close - vwap) / sigma. */
  z: number;
  /** Distance back to VWAP in basis points of price: the trade's expected gross gain. */
  edgeBps: number;
}

/**
 * Fade the bar (sell an up bar, buy a down bar) only when it leaves the close at least
 * entryZ sigmas from VWAP on that same side (but short of stopZ: a trade entered past
 * its own stop would be stopped on the next bar), and the way back to VWAP beats minEdgeBps.
 */
type DivergenceKnobs = Pick<Team3ReversalConfig, "divMinZ" | "divSpyZ" | "divCrossMin" | "divCrossMax" | "stopZ">;

/**
 * S5 candidate 1 (strategy-survey.md): the stock is stretched from its VWAP while SPY is stretched
 * the opposite way, on a day the stock has crossed VWAP only 1-2 times in the window. Side fades z.
 */
export function spyDivergenceIdea(bar: BarView, prev: BarView, vwap: VwapView | null, spy: VwapView | null, c: DivergenceKnobs): EntryIdea | null {
  if (!vwap || vwap.z === null || !spy || spy.z === null) return null;
  const az = Math.abs(vwap.z);
  if (az < c.divMinZ || az >= c.stopZ) return null;
  if (Math.abs(spy.z) < c.divSpyZ || Math.sign(spy.z) === Math.sign(vwap.z)) return null;
  if (vwap.crossings < c.divCrossMin || vwap.crossings > c.divCrossMax) return null;
  const side: Side = vwap.z > 0 ? "sell" : "buy";
  const edgeBps = (Math.abs(bar.close - vwap.vwap) / bar.close) * 10_000;
  return { side, move: (bar.close - prev.close) / prev.close, z: vwap.z, edgeBps };
}

type OwnQuietKnobs = Pick<Team3ReversalConfig, "divMinZ" | "stopZ" | "oqMinOwnShare" | "oqMaxTrendBps" | "lookbackBars">;

/**
 * S5 candidate 2 (strategy-survey.md): a stretch that is mostly the stock's own move (beta-1 residual
 * share over lookbackBars) on a day that has gone nowhere so far. `today` and `spyToday` are the
 * session bars up to and including `bar`. Side fades z.
 */
export function ownQuietIdea(today: readonly BarView[], spyToday: readonly BarView[], vwap: VwapView | null, c: OwnQuietKnobs): EntryIdea | null {
  const n = today.length;
  if (!vwap || vwap.z === null || n < 2) return null;
  const bar = today[n - 1], prev = today[n - 2];
  const az = Math.abs(vwap.z);
  if (az < c.divMinZ || az >= c.stopZ) return null;
  const start = today[Math.max(0, n - 1 - c.lookbackBars)];
  const spyAt = (ts: number) => { for (let i = spyToday.length - 1; i >= 0; i--) { if (spyToday[i].ts === ts) return spyToday[i].close; if (spyToday[i].ts < ts) break; } return null; };
  const s0 = spyAt(start.ts), s1 = spyAt(bar.ts);
  if (s0 === null || s1 === null || start.close <= 0) return null;
  const total = bar.close / start.close - 1;
  if (total === 0) return null;
  const own = Math.abs(total - (s1 / s0 - 1)) / Math.abs(total);
  const trendBps = (Math.abs(bar.close - today[0].open) / today[0].open) * 10_000;
  if (!(own > c.oqMinOwnShare) || trendBps > c.oqMaxTrendBps) return null;
  const side: Side = vwap.z > 0 ? "sell" : "buy";
  const edgeBps = (Math.abs(bar.close - vwap.vwap) / bar.close) * 10_000;
  return { side, move: (bar.close - prev.close) / prev.close, z: vwap.z, edgeBps };
}

/** Entry-time features for the condition entry, computed the way runtime/team3Analysis/features.ts does. */
export interface ConditionFeatures {
  ownShare: number; absZ: number; edgeBps: number; crossings60: number; volRatio: number;
  rangeSigma: number; trendBps: number; timeOfDay: number;
  /** SPY's z at this minute (NaN if missing). */
  spyZ: number;
  /** 1 if the bar moved toward VWAP vs the previous close. */
  turnBar: 0 | 1;
}

type ConditionKnobs = Pick<Team3ReversalConfig, "divMinZ" | "stopZ" | "ceRanges" | "ceSpySide" | "ceTurnBar">;

/** F3-F5: the opportunity set AND every configured (lo, hi] range, SPY side and turn-bar condition. */
export function conditionIdea(bar: BarView, prev: BarView, vwap: VwapView | null, f: ConditionFeatures, c: ConditionKnobs): EntryIdea | null {
  if (!vwap || vwap.z === null) return null;
  const az = Math.abs(vwap.z);
  if (az < c.divMinZ || az >= c.stopZ) return null;
  for (const [k, r] of Object.entries(c.ceRanges ?? {})) {
    if (!r) continue;
    const x = f[k as keyof ConditionFeatures] as number;
    if (!Number.isFinite(x)) return null;
    if (r[0] !== null && !(x > r[0])) return null;
    if (r[1] !== null && !(x <= r[1])) return null;
  }
  if (c.ceSpySide !== null) {
    if (!Number.isFinite(f.spyZ)) return null;
    const side = Math.abs(f.spyZ) < 1 ? "neutral" : Math.sign(f.spyZ) === Math.sign(vwap.z) ? "same" : "opposite";
    if (side !== c.ceSpySide) return null;
  }
  if (c.ceTurnBar !== null && f.turnBar !== c.ceTurnBar) return null;
  const side: Side = vwap.z > 0 ? "sell" : "buy";
  const edgeBps = (Math.abs(bar.close - vwap.vwap) / bar.close) * 10_000;
  return { side, move: (bar.close - prev.close) / prev.close, z: vwap.z, edgeBps };
}

export function entryIdea(bar: BarView, prev: BarView, vwap: VwapView | null, c: EntryKnobs): EntryIdea | null {
  if (c.useTurnEntry) return turnEntryIdea(bar, prev, vwap, c);
  if (!vwap || vwap.z === null || bar.close === prev.close) return null;
  const move = (bar.close - prev.close) / prev.close;
  const side: Side = move > 0 ? "sell" : "buy";
  const stretched = (side === "sell" ? vwap.z >= c.entryZ : vwap.z <= -c.entryZ) && Math.abs(vwap.z) < c.stopZ;
  const edgeBps = (Math.abs(bar.close - vwap.vwap) / bar.close) * 10_000;
  return stretched && edgeBps >= c.minEdgeBps ? { side, move, z: vwap.z, edgeBps } : null;
}

/**
 * Turn entry (R1, useTurnEntry): same stretch, stop and edge tests, but the side comes from z
 * (above VWAP -> sell, below -> buy) and the bar must move back toward VWAP vs the previous close.
 * Docs: docs/team3/components/turn-entry.md
 */
export function turnEntryIdea(bar: BarView, prev: BarView, vwap: VwapView | null, c: EntryKnobs): EntryIdea | null {
  if (!vwap || vwap.z === null || vwap.z === 0) return null;
  const move = (bar.close - prev.close) / prev.close;
  const side: Side = vwap.z > 0 ? "sell" : "buy";
  const turning = side === "sell" ? bar.close < prev.close : bar.close > prev.close;
  const stretched = Math.abs(vwap.z) >= c.entryZ && Math.abs(vwap.z) < c.stopZ;
  const edgeBps = (Math.abs(bar.close - vwap.vwap) / bar.close) * 10_000;
  return turning && stretched && edgeBps >= c.minEdgeBps ? { side, move, z: vwap.z, edgeBps } : null;
}

export interface HoldingView {
  /** Shares held: positive long, negative short. Never 0 here. */
  qty: number;
  /** Session bars closed since the entry filled (1 on the first bar after the fill). */
  barsHeld: number;
  /** True when the entry filled on an earlier New York day. */
  fromEarlierDay: boolean;
  /** R4: vwapZ of the entry signal bar (null if unknown). Only read by the partway target. */
  entryZ?: number | null;
  /** R4 scale-out: true once half the position was already closed at the partway point. */
  scaledOut?: boolean;
}

/** R4 partway target: z has come back tpFraction of the way from the entry z toward 0. */
export function partwayReached(short: boolean, z: number, entryZ: number, tpFraction: number): boolean {
  const level = (1 - tpFraction) * entryZ;
  return short ? z <= level : z >= level;
}

/** First reason that applies wins. null = keep holding. */
export function exitReason(h: HoldingView, window: SessionWindow, z: number | null, c: ExitKnobs): ExitReason | null {
  const short = h.qty < 0;
  if (h.fromEarlierDay) return "stale";                                         // safety net: never carry overnight
  if (window === "flatten") return "close";                                     // flat before the bell
  if (z !== null && (short ? z >= c.stopZ : z <= -c.stopZ)) return "stop";     // stretched further: trend day
  if (z !== null && (short ? z <= 0 : z >= 0)) return "target";                 // back to VWAP
  if ((c.usePartwayTarget || (c.useScaleOut && !h.scaledOut)) && z !== null && h.entryZ != null
    && partwayReached(short, z, h.entryZ, c.tpFraction)) return "partway";        // R4: took the fast part of the reversion
  if (h.barsHeld >= c.maxHoldBars) return "time";                               // waited long enough
  return null;
}
