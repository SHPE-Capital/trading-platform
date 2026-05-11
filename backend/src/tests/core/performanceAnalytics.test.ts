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
