import { crowdSize, crowdSplitQty } from '../../../strategies/team3Reversal/sizing';
import { createTeam3ReversalConfig, validateTeam3ReversalConfig } from '../../../strategies/team3Reversal/team3ReversalConfig';
import { r5Metrics } from '../../../runtime/team3Metrics/r5';
import type { RoundTrip } from '../../../runtime/team3Metrics/trades';

describe('crowd split: one cluster, one bet budget', () => {
  it('counts only symbols stretched the same way (|z| >= entryZ)', () => {
    expect(crowdSize([-2.5, -2, -1.9, 2.4, null], 'buy', 2)).toBe(2);
    expect(crowdSize([-2.5, -2, 2.4, 3], 'sell', 2)).toBe(2);
  });
  it('divides and floors, keeping at least 1 share', () => {
    expect(crowdSplitQty(50, 3)).toBe(16);
    expect(crowdSplitQty(2, 6)).toBe(1);
    expect(crowdSplitQty(50, 0)).toBe(50);
    expect(crowdSplitQty(0, 3)).toBe(0);
  });
  it('is off by default and validates', () => {
    const c = createTeam3ReversalConfig();
    expect(c.useCrowdSplit).toBe(false);
    expect(() => validateTeam3ReversalConfig({ ...c, useCrowdSplit: 'yes' as unknown as boolean })).toThrow();
  });
});

describe('r5Metrics', () => {
  const t = (symbol: string, entryTs: number, pnlBpsGross: number, qty = 10, qtyWanted = 10): RoundTrip => ({
    symbol, side: 'buy', entryTs, exitTs: entryTs + 60_000, qty, qtyWanted, entryClose: 100, entryZ: -2, edgeBps: 20, reason: 'target', barsHeld: 1, pnlBpsGross,
  });
  const ts = Date.UTC(2026, 9, 6, 16, 0);
  it('finds clusters, cap binding and cluster-day drawdown', () => {
    const m = r5Metrics({
      signals: [], barsBySymbol: new Map(), config: {},
      roundTrips: [t('A', ts, -100), t('B', ts, -100), t('C', ts, 50, 5, 10), t('A', ts + 3_600_000, 10)],
      daily: [{ date: '2026-10-05', pnl: 5 }, { date: '2026-10-06', pnl: -15 }],
    });
    expect(m.clusters).toBe(1);
    expect(m.worstClusterLossUsd).toBe(-17.5);
    expect(m.capBindShare).toBe(0.25);
    expect(m.clusterDays).toBe(1);
    expect(m.clusterDayMaxDdUsd).toBe(15);
  });
});
