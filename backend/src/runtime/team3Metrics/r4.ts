/**
 * runtime/team3Metrics/r4.ts
 *
 * R4 exits: win rate, avg win / avg loss (gross bps per round trip), the exit mix,
 * the 5th-percentile trade, and reversion share (target + partway exits / round trips).
 * Set TEAM3_R4_DUMP=<file> to also write every round trip as JSON, so a stop-off row
 * can be matched to the baseline's stopped trades (symbol + entry time) offline.
 * Owner: the r4 Stage 2 session (branch team3/r4). Only that session edits this file.
 */

import { writeFileSync } from "fs";
import type { MetricInput, RoundTrip } from "./trades";

/**
 * Scale-out rows emit two exit signals per trade (a `partial` one, then the rest); the shared
 * pairing keeps only the first. This pairs them again: one trip per entry, gross bps =
 * share-weighted over its legs, reason = the last leg's, and `partway` if any leg was partway.
 */
function scaleOutTrips(signals: MetricInput["signals"]): RoundTrip[] {
  const open = new Map<string, { e: (typeof signals)[number]; legs: { qty: number; bps: number; reason: string; bars: number }[] }>();
  const out: RoundTrip[] = [];
  for (const s of signals) {
    const kind = s.meta?.kind;
    if (kind === "enter") { open.set(s.symbol, { e: s, legs: [] }); continue; }
    if (kind !== "exit") continue;
    const o = open.get(s.symbol);
    if (!o) continue;
    o.legs.push({ qty: Math.abs(s.qty), bps: Number(s.meta?.pnlBpsGross), reason: String(s.meta?.reason), bars: Number(s.meta?.barsHeld) });
    if (s.meta?.partial === true) continue;
    open.delete(s.symbol);
    const q = o.legs.reduce((n, l) => n + l.qty, 0);
    const last = o.legs[o.legs.length - 1];
    out.push({
      symbol: s.symbol, side: o.e.direction === "short" ? "sell" : "buy", entryTs: o.e.ts, exitTs: s.ts, qty: q, qtyWanted: null,
      entryClose: Number(o.e.meta?.close), entryZ: Number(o.e.meta?.vwapZ), edgeBps: Number(o.e.meta?.edgeBps),
      reason: o.legs.length > 1 && last.reason !== "target" ? `partway+${last.reason}` : last.reason,
      barsHeld: last.bars, pnlBpsGross: o.legs.reduce((n, l) => n + l.qty * l.bps, 0) / q,
    });
  }
  return out;
}

const r2 = (x: number) => +x.toFixed(2);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function r4Metrics(input: MetricInput): Record<string, unknown> {
  const scaled = input.signals.some((s) => s.meta?.partial === true);
  const roundTrips = scaled ? scaleOutTrips(input.signals) : input.roundTrips;
  const dump = process.env.TEAM3_R4_DUMP?.trim();
  if (dump) {
    writeFileSync(dump, JSON.stringify(roundTrips.map((t) => ({
      symbol: t.symbol, side: t.side, entryTs: t.entryTs, exitTs: t.exitTs, qty: t.qty, entryZ: t.entryZ,
      reason: t.reason, barsHeld: t.barsHeld, pnlBpsGross: t.pnlBpsGross,
    }))));
  }
  const bps = roundTrips.map((t) => t.pnlBpsGross).filter((x) => Number.isFinite(x));
  if (!bps.length) return {};
  const wins = bps.filter((x) => x > 0);
  const losses = bps.filter((x) => x <= 0);
  const mix: Record<string, number> = {};
  for (const t of roundTrips) mix[t.reason] = (mix[t.reason] ?? 0) + 1;
  const sorted = [...bps].sort((a, b) => a - b);
  const reverted = Object.entries(mix).filter(([r]) => r === "target" || r.startsWith("partway")).reduce((n, [, k]) => n + k, 0);
  return {
    roundTrips: roundTrips.length,
    winRatePct: r2((wins.length / bps.length) * 100),
    avgWinBps: wins.length ? r2(mean(wins)!) : null,
    avgLossBps: losses.length ? r2(mean(losses)!) : null,
    avgGrossBps: r2(mean(bps)!),
    p5TradeBps: r2(sorted[Math.floor(0.05 * (sorted.length - 1))]),
    exitMix: mix,
    reversionSharePct: r2((reverted / roundTrips.length) * 100),
  };
}
