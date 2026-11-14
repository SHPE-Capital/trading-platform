/** Deterministic mock of the E2 JSON summary (no randomness, so tests are stable). */
import type { EquityPoint, MomentumResultsSummary, ResultsPolicy, WeeklyChoice } from "./types";

const POLICIES: ResultsPolicy[] = ["similarity", "recency", "uniform"];
const DRIFT: Record<ResultsPolicy, number> = { similarity: 0.0009, recency: 0.0005, uniform: 0.0003 };
const WEEKS = 12;
const NO_DEPLOY_WEEK = 4;

function wave(i: number, k: number): number {
  return Math.sin(i * 1.7 + k) * 0.004 + Math.cos(i * 0.6 + k * 2) * 0.002;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function buildMockSummary(): MomentumResultsSummary {
  const start = "2026-06-01"; // a Monday
  const days: string[] = [];
  for (let w = 0; w < WEEKS; w++) for (let d = 0; d < 5; d++) days.push(addDays(start, w * 7 + d));

  const equity: EquityPoint[] = [];
  const level: Record<ResultsPolicy, number> = { similarity: 1, recency: 1, uniform: 1 };
  const peak: Record<ResultsPolicy, number> = { similarity: 1, recency: 1, uniform: 1 };
  const maxDd: Record<ResultsPolicy, number> = { similarity: 0, recency: 0, uniform: 0 };
  days.forEach((date, i) => {
    POLICIES.forEach((p, k) => {
      level[p] *= 1 + DRIFT[p] + wave(i, k);
      peak[p] = Math.max(peak[p], level[p]);
      maxDd[p] = Math.min(maxDd[p], level[p] / peak[p] - 1);
    });
    equity.push({ date, ...level });
  });

  const choice = (p: ResultsPolicy, w: number): WeeklyChoice => {
    const k = POLICIES.indexOf(p);
    if (p !== "uniform" && w === NO_DEPLOY_WEEK) {
      return { configId: null, netReturn: 0, noDeploymentReason: "no candidate passed validation" };
    }
    return { configId: `mom-${(0x9f3c2a71 + w * 977 + k * 31).toString(16)}`, netReturn: 0.004 + wave(w, k), noDeploymentReason: null };
  };

  const last = equity[equity.length - 1];
  const policies = POLICIES.map((policy, k) => ({
    policy,
    cumulativeNetReturn: last[policy] - 1,
    endingEquity: 100_000 * last[policy],
    maxDrawdown: maxDd[policy],
    avgDailyReturn: DRIFT[policy],
    downsideDeviation: 0.0031 + k * 0.0004,
    tradeCount: 420 - k * 35,
    activeDays: days.length - (policy === "uniform" ? 0 : 5),
    noDeploymentWeeks: policy === "uniform" ? 0 : 1,
    avgHoldMinutes: 41 - k * 3,
    exposure: 0.38 - k * 0.03,
    turnover: 9.2 - k * 0.8,
    rejectedSignals: 130 + k * 12,
    concentration: { topWeeksShare: 0.46 + k * 0.05, topStocksShare: 0.31 + k * 0.03 },
    calibrationRuntimeSeconds: 5400 - k * 1100,
  }));

  return {
    meta: {
      strategy: "Intraday momentum (RM9 weekly calibration)",
      dataVersion: "bars-2026-11-06-v3",
      costModel: "10 bps per side",
      forwardPeriod: { start: days[0], end: days[days.length - 1] },
      generatedAt: "2026-11-13T12:00:00Z",
    },
    policies,
    equity,
    paired: {
      meanDaily: DRIFT.similarity - DRIFT.recency,
      nDays: days.length,
      resamples: 2000,
      intervals: [
        { blockLength: 5, primary: true, lo: -0.0004, hi: 0.0012 },
        { blockLength: 10, primary: false, lo: -0.0006, hi: 0.0014 },
        { blockLength: 20, primary: false, lo: -0.0009, hi: 0.0017 },
      ],
    },
    costSensitivity: [5, 10, 20].map((bps) => ({
      bps,
      similarity: last.similarity - 1 - (bps - 10) * 0.0021,
      recency: last.recency - 1 - (bps - 10) * 0.0021,
      uniform: last.uniform - 1 - (bps - 10) * 0.0021,
    })),
    weekly: Array.from({ length: WEEKS }, (_, w) => ({
      weekStart: addDays(start, w * 7),
      similarity: choice("similarity", w),
      recency: choice("recency", w),
      uniform: choice("uniform", w),
    })),
  };
}
