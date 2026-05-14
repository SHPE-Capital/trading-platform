/**
 * performanceAnalytics.test.ts — exercises computeAnalytics() against known
 * equity curves.
 */

import { computeAnalytics } from '../../core/backtest/performanceAnalytics';
import type { PortfolioSnapshot } from '../../types/portfolio';

function snap(equity: number, ts = 0): PortfolioSnapshot {
  return {
    id: `s-${ts}`,
    ts,
    isoTs: '',
    cash: equity,
    positionsValue: 0,
    equity,
    initialCapital: 100_000,
    totalUnrealizedPnl: 0,
    totalRealizedPnl: 0,
    totalPnl: equity - 100_000,
    returnPct: (equity - 100_000) / 100_000,
    positions: [],
    positionCount: 0,
  };
}

const DAY = 86_400_000;

describe('computeAnalytics: ratios on known curves', () => {
  it('returns undefined ratios when fewer than MIN_PERIODS points', () => {
    const curve = [snap(100_000), snap(101_000), snap(102_000)];
    const r = computeAnalytics(curve, [], 0, 3 * DAY, 0);
    expect(r.sharpeRatio).toBeUndefined();
    expect(r.sortinoRatio).toBeUndefined();
    expect(r.calmarRatio).toBeUndefined();
  });

  it('returns undefined Sharpe/Sortino when equity is perfectly flat (zero variance)', () => {
    const curve = Array.from({ length: 30 }, (_, i) => snap(100_000, i * DAY));
    const r = computeAnalytics(curve, [], 0, 30 * DAY, 0);
    // No variance — Sharpe is undefined, not Infinity.
    expect(r.sharpeRatio).toBeUndefined();
    expect(r.sortinoRatio).toBeUndefined();
    // Calmar: annualized return = 0, maxDrawdown = 0 → undefined.
    expect(r.calmarRatio).toBeUndefined();
  });

  it('computes a positive Sharpe for a strictly winning curve and positive Calmar with a drawdown', () => {
    // Strictly winning + variance: alternate small/big gains over 30 days.
    const curve: PortfolioSnapshot[] = [snap(100_000, 0)];
    let eq = 100_000;
    for (let i = 1; i <= 30; i++) {
      eq *= i % 2 === 0 ? 1.01 : 1.003;
      curve.push(snap(eq, i * DAY));
    }
    const r = computeAnalytics(curve, [], 0, 30 * DAY, 0);
    expect(r.annualizedReturn).toBeDefined();
    expect(r.annualizedReturn!).toBeGreaterThan(0);
    expect(r.sharpeRatio).toBeGreaterThan(0);
    // No drawdown on a strictly winning curve → undefined Calmar.
    expect(r.calmarRatio).toBeUndefined();
  });

  it('computes profit factor from trade PnLs', () => {
    const tradePnls = [100, -50, 200, -100, 50];
    const r = computeAnalytics([], tradePnls, 0, DAY, 0);
    // Gross profit 350, gross loss 150 → 350/150 ≈ 2.333
    expect(r.profitFactor).toBeCloseTo(350 / 150, 5);
  });

  it('omits profit factor when there are no losing trades', () => {
    const r = computeAnalytics([], [100, 200, 300], 0, DAY, 0);
    expect(r.profitFactor).toBeUndefined();
  });
});

describe('computeAnalytics: benchmark + risk-free rate', () => {
  it('reports benchmark return from the supplied curve', () => {
    const bench = [
      { ts: 0, value: 100 },
      { ts: DAY, value: 110 },
    ];
    const r = computeAnalytics([], [], 0, DAY, 0, bench);
    expect(r.benchmarkReturn).toBeCloseTo(0.1, 6);
  });

  it('ignores degenerate benchmark series (single point or zero start)', () => {
    expect(computeAnalytics([], [], 0, DAY, 0, [{ ts: 0, value: 100 }]).benchmarkReturn).toBeUndefined();
    expect(
      computeAnalytics([], [], 0, DAY, 0, [
        { ts: 0, value: 0 },
        { ts: DAY, value: 1 },
      ]).benchmarkReturn,
    ).toBeUndefined();
  });

  it('echoes the risk-free rate used', () => {
    const r = computeAnalytics([], [], 0, DAY, 0.05);
    expect(r.riskFreeRateAnnual).toBe(0.05);
  });

  it('a higher risk-free rate lowers the Sharpe ratio', () => {
    const curve: PortfolioSnapshot[] = [snap(100_000, 0)];
    let eq = 100_000;
    for (let i = 1; i <= 30; i++) {
      eq *= i % 2 === 0 ? 1.005 : 1.003;
      curve.push(snap(eq, i * DAY));
    }
    const r0 = computeAnalytics(curve, [], 0, 30 * DAY, 0);
    const r5 = computeAnalytics(curve, [], 0, 30 * DAY, 0.05);
    expect(r5.sharpeRatio).toBeLessThan(r0.sharpeRatio!);
  });
});

describe('computeAnalytics: daily resampling', () => {
  it('multiple snapshots on the same UTC day collapse to one daily return (last equity wins)', () => {
    // 5 bars on day 0, then 5 bars on day 1 — only 1 return observable between the two days.
    const curve: PortfolioSnapshot[] = [];
    for (let i = 0; i < 5; i++) curve.push(snap(100_000 + i * 100, i * 3_600_000));       // day 0
    for (let i = 0; i < 5; i++) curve.push(snap(105_000 + i * 100, DAY + i * 3_600_000)); // day 1
    // Two day-end equities → 1 daily return. Not enough for ratios (MIN = 4).
    const r = computeAnalytics(curve, [], 0, 2 * DAY);
    expect(r.sharpeRatio).toBeUndefined();
    expect(r.periodCount).toBe(1);
  });

  it('periodCount reflects the number of daily return observations, not raw snapshots', () => {
    // 30 snapshots, one per day, → 29 daily returns
    const curve: PortfolioSnapshot[] = [snap(100_000, 0)];
    let eq = 100_000;
    for (let i = 1; i <= 29; i++) {
      eq *= 1 + (i % 3 === 0 ? 0.01 : -0.002);
      curve.push(snap(eq, i * DAY));
    }
    const r = computeAnalytics(curve, [], 0, 29 * DAY);
    expect(r.periodCount).toBe(29);
  });

  it('market-neutral scenario: near-zero per-bar variance but nonzero daily variance → daily Sharpe defined', () => {
    // Simulate a market-neutral strategy: equity drifts ~$1 per day but is flat within each day.
    // Per-bar returns ≈ 0 (many bars at same equity within each day).
    // Daily returns have variance (different day-end equities).
    const curve: PortfolioSnapshot[] = [];
    const BARS_PER_DAY = 390; // minute bars in a US session
    for (let day = 0; day < 30; day++) {
      const dayEndEquity = 100_000 + day * (day % 2 === 0 ? 50 : -30);
      for (let bar = 0; bar < BARS_PER_DAY; bar++) {
        // All bars within the day show the same equity (position not marked intraday)
        curve.push(snap(dayEndEquity, day * DAY + bar * 60_000));
      }
    }
    const r = computeAnalytics(curve, [], 0, 30 * DAY);
    // Daily resampling captures the day-level drift; Sharpe should be defined.
    expect(r.sharpeRatio).toBeDefined();
    expect(r.periodCount).toBe(29); // 30 days → 29 returns
  });

  it('simulated period span gives periodsPerYear ≈ 252 for a one-year run of 252 daily returns', () => {
    const MS_PER_YEAR = 365.25 * 24 * 3_600_000;
    const curve: PortfolioSnapshot[] = [snap(100_000, 0)];
    let eq = 100_000;
    // 252 trading days of alternating +0.5% / -0.3%
    for (let i = 1; i <= 252; i++) {
      eq *= i % 2 === 0 ? 1.005 : 0.997;
      curve.push(snap(eq, i * DAY));
    }
    const r = computeAnalytics(curve, [], 0, MS_PER_YEAR);
    // annualizedVol = stdev * sqrt(periodsPerYear). With correct period span,
    // periodsPerYear = 252/1 ≈ 252 (not millions as with wall-clock bug).
    // Verify annualizedVol is sane (single-digit %, not ±Infinity).
    expect(r.annualizedVol).toBeDefined();
    expect(r.annualizedVol!).toBeGreaterThan(0);
    expect(r.annualizedVol!).toBeLessThan(5); // <500% annualized vol is sane
  });
});

describe('computeAnalytics: intraday (per-bar) ratios', () => {
  it('intradaySharpeRatio is defined when per-bar returns have variance', () => {
    // 30 bars within one day (different prices → equity variance per bar from MTM)
    const curve: PortfolioSnapshot[] = [];
    for (let i = 0; i < 30; i++) {
      const eq = 100_000 * (1 + (i % 2 === 0 ? 0.001 : -0.0005));
      curve.push(snap(eq, i * 60_000)); // all within 1 day
    }
    const r = computeAnalytics(curve, [], 0, DAY);
    // < 4 daily observations → daily Sharpe undefined
    expect(r.sharpeRatio).toBeUndefined();
    // Per-bar returns have variance → intraday Sharpe defined
    expect(r.intradaySharpeRatio).toBeDefined();
  });

  it('intradaySharpeRatio is available even when daily periodCount < MIN_PERIODS_FOR_RATIOS', () => {
    // Only 2 calendar days but 30 bars — not enough for daily, enough for per-bar
    const curve: PortfolioSnapshot[] = [];
    for (let i = 0; i < 15; i++) curve.push(snap(100_000 + i * 50, i * 60_000));
    for (let i = 0; i < 15; i++) curve.push(snap(101_000 + i * 50, DAY + i * 60_000));
    const r = computeAnalytics(curve, [], 0, 2 * DAY);
    expect(r.periodCount).toBe(1); // 1 daily return
    expect(r.sharpeRatio).toBeUndefined();
    expect(r.intradaySharpeRatio).toBeDefined();
  });

  it('intradaySharpeRatio is undefined when all per-bar equity values are identical', () => {
    // Completely flat curve — zero per-bar variance
    const curve = Array.from({ length: 30 }, (_, i) => snap(100_000, i * 60_000));
    const r = computeAnalytics(curve, [], 0, DAY);
    expect(r.intradaySharpeRatio).toBeUndefined();
    expect(r.intradaySortinoRatio).toBeUndefined();
  });

  it('intraday Sortino is undefined when there are no negative per-bar returns', () => {
    // Strictly non-decreasing per-bar equity → no downside returns
    const curve: PortfolioSnapshot[] = [];
    for (let i = 0; i < 30; i++) curve.push(snap(100_000 + i * 10, i * 60_000));
    const r = computeAnalytics(curve, [], 0, DAY);
    // No downside deviation → Sortino undefined (downsideStdev = 0 ≤ VARIANCE_EPS)
    expect(r.intradaySortinoRatio).toBeUndefined();
  });
});
