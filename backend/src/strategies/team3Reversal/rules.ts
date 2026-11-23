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
type EntryKnobs = Pick<Team3ReversalConfig, "entryZ" | "minEdgeBps" | "stopZ">;
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
export function entryIdea(bar: BarView, prev: BarView, vwap: VwapView | null, c: EntryKnobs): EntryIdea | null {
  if (!vwap || vwap.z === null || bar.close === prev.close) return null;
  const move = (bar.close - prev.close) / prev.close;
  const side: Side = move > 0 ? "sell" : "buy";
  const stretched = (side === "sell" ? vwap.z >= c.entryZ : vwap.z <= -c.entryZ) && Math.abs(vwap.z) < c.stopZ;
  const edgeBps = (Math.abs(bar.close - vwap.vwap) / bar.close) * 10_000;
  return stretched && edgeBps >= c.minEdgeBps ? { side, move, z: vwap.z, edgeBps } : null;
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
