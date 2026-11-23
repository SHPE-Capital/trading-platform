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
import type { MetricInput } from "./trades";

const r2 = (x: number) => +x.toFixed(2);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function r4Metrics({ roundTrips }: MetricInput): Record<string, unknown> {
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
  const reverted = (mix.target ?? 0) + (mix.partway ?? 0);
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
