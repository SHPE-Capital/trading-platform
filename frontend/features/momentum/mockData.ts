/** Mock snapshot for P3-2; replaced by the P3-1 API through dataSource.ts. */
import type { MomentumDataSource, MomentumLiveSnapshot } from "./types";

export function buildMockSnapshot(now: Date = new Date()): MomentumLiveSnapshot {
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
  return {
    config: {
      configId: "mom-9f3c2a71",
      policy: "similarity",
      activationWeek: "2026-11-09",
      artifactCreatedAt: ago(60 * 30),
      freshnessLimitHours: 72,
      noDeploymentReason: null,
      params: { breakoutMinutes: 20, emaFast: 9, emaSlow: 21, rvolWindow: 20, rvolMin: 1.5, adxPeriod: 14, adxMin: 20 },
      exit: { maxHoldMinutes: 60, initialStopAtr: 1.5, sessionExitMinutesBeforeClose: 5 },
    },
    universe: { size: 500, sample: ["AAPL", "MSFT", "NVDA", "AMD", "TSLA", "META", "AMZN", "NFLX", "CRM", "UBER"] },
    entries: { enabled: true, reason: null },
    halt: { dayPnlPct: -0.0032, dayPnl: -320, haltPct: 0.01, halted: false },
    positions: [
      { symbol: "NVDA", qty: 40, entryPrice: 142.1, lastPrice: 143.4, stopPrice: 139.9, enteredAt: ago(22) },
      { symbol: "AMD", qty: 90, entryPrice: 101.25, lastPrice: 100.6, stopPrice: 99.1, enteredAt: ago(51) },
    ],
    orders: [
      {
        id: "ord-1003", symbol: "AMD", side: "buy", qty: 90, status: "filled", at: ago(51),
        audit: [
          { stage: "signal", at: ago(52), detail: "20m breakout, EMA 9>21, RVOL 1.8" },
          { stage: "risk_check", at: ago(52), detail: "passed: exposure 31% of 80% cap" },
          { stage: "order", at: ago(51), detail: "limit buy, markup 0.20%" },
          { stage: "fill", at: ago(51), detail: "90 @ 101.25" },
        ],
      },
      {
        id: "ord-1004", symbol: "NVDA", side: "buy", qty: 40, status: "filled", at: ago(22),
        audit: [
          { stage: "signal", at: ago(23), detail: "20m breakout, EMA 9>21, RVOL 2.1" },
          { stage: "risk_check", at: ago(23), detail: "passed" },
          { stage: "order", at: ago(22), detail: "limit buy" },
          { stage: "fill", at: ago(22), detail: "40 @ 142.10" },
        ],
      },
      {
        id: "ord-1002", symbol: "TSLA", side: "buy", qty: 25, status: "rejected", at: ago(95),
        audit: [
          { stage: "signal", at: ago(96), detail: "20m breakout, RVOL 1.6" },
          { stage: "risk_check", at: ago(96), detail: "rejected: STALE_QUOTE" },
        ],
      },
    ],
    lastBarAt: ago(1),
    asOf: now.toISOString(),
  };
}

export const mockMomentumSource: MomentumDataSource = {
  getLive: async () => buildMockSnapshot(),
};
