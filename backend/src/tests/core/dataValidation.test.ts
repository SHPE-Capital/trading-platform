/**
 * dataValidation.test.ts — exercises validateBars().
 */

import { validateBars } from '../../core/backtest/dataValidation';
import type { Bar } from '../../types/market';

function bar(overrides: Partial<Bar>): Bar {
  return {
    symbol: 'SPY',
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 1_000,
    ts: 1_000,
    isoTs: new Date(1_000).toISOString(),
    timeframe: '1Min',
    ...overrides,
  };
}

describe('validateBars: structural', () => {
  it('passes a clean single-symbol series', () => {
    const bars = [bar({ ts: 1_000 }), bar({ ts: 2_000 }), bar({ ts: 3_000 })];
    const r = validateBars(bars, ['SPY']);
    // raw-adjustment warning is always added; ok requires only no errors
    expect(r.ok).toBe(true);
    expect(r.metadata.totalBarsAccepted).toBe(3);
    expect(r.issues.some((i) => i.severity === 'error')).toBe(false);
  });

  it('drops bars with non-finite OHLC', () => {
    const bars = [bar({ ts: 1_000 }), bar({ ts: 2_000, open: NaN })];
    const r = validateBars(bars, ['SPY']);
    expect(r.metadata.invalidBarsDropped).toBe(1);
    expect(r.bars).toHaveLength(1);
    expect(r.ok).toBe(false);
  });

  it('drops bars with high < low (inconsistent)', () => {
    const bars = [bar({ ts: 1_000, high: 50, low: 60, open: 55, close: 55 })];
    const r = validateBars(bars, ['SPY']);
    expect(r.bars).toHaveLength(0);
    expect(r.issues.find((i) => i.severity === 'error')?.message).toMatch(/inconsistent/i);
  });

  it('drops bars where high < max(open, close)', () => {
    const bars = [bar({ ts: 1_000, open: 100, close: 200, high: 150, low: 90 })];
    const r = validateBars(bars, ['SPY']);
    expect(r.bars).toHaveLength(0);
  });

  it('rejects negative volume; accepts zero volume', () => {
    const bars = [bar({ ts: 1_000, volume: -5 }), bar({ ts: 2_000, volume: 0 })];
    const r = validateBars(bars, ['SPY']);
    expect(r.metadata.invalidBarsDropped).toBe(1);
    expect(r.bars).toHaveLength(1);
    expect(r.bars[0].volume).toBe(0);
  });
});

describe('validateBars: ordering and duplicates', () => {
  it('detects out-of-order bars per symbol', () => {
    const bars = [bar({ ts: 2_000 }), bar({ ts: 1_000 })];
    const r = validateBars(bars, ['SPY']);
    expect(r.metadata.invalidBarsDropped).toBe(1);
    expect(r.issues.find((i) => i.message.match(/out of order/i))).toBeDefined();
  });

  it('drops duplicate timestamps for the same symbol with a warning', () => {
    const bars = [bar({ ts: 1_000 }), bar({ ts: 1_000 })];
    const r = validateBars(bars, ['SPY']);
    expect(r.metadata.duplicateBarsDropped).toBe(1);
    expect(r.bars).toHaveLength(1);
    expect(r.issues.find((i) => i.message.match(/duplicate/i))?.severity).toBe('warning');
  });

  it('multi-symbol bars at same ts are NOT duplicates (different symbols)', () => {
    const bars = [
      bar({ symbol: 'SPY', ts: 1_000 }),
      bar({ symbol: 'QQQ', ts: 1_000 }),
    ];
    const r = validateBars(bars, ['SPY', 'QQQ']);
    expect(r.metadata.duplicateBarsDropped).toBe(0);
    expect(r.bars).toHaveLength(2);
  });
});

describe('validateBars: gap detection and metadata', () => {
  it('flags gaps larger than 2x median spacing per symbol', () => {
    // 60s cadence with one 10-minute gap at the end.
    const bars: Bar[] = [];
    for (let i = 0; i < 10; i++) bars.push(bar({ ts: 1_000 + i * 60_000 }));
    bars.push(bar({ ts: 1_000 + 9 * 60_000 + 600_000 }));
    const r = validateBars(bars, ['SPY']);
    expect(r.metadata.largeGapsBySymbol['SPY']).toBeGreaterThanOrEqual(1);
    expect(r.issues.find((i) => i.message.match(/gaps/i))?.severity).toBe('warning');
  });

  it('records median spacing per symbol', () => {
    const bars = [bar({ ts: 1_000 }), bar({ ts: 2_000 }), bar({ ts: 3_000 })];
    const r = validateBars(bars, ['SPY']);
    expect(r.metadata.medianSpacingMsBySymbol['SPY']).toBe(1_000);
  });

  it('warns when a requested symbol has no bars', () => {
    const bars = [bar({ symbol: 'SPY', ts: 1_000 })];
    const r = validateBars(bars, ['SPY', 'MISSING']);
    expect(
      r.issues.find((i) => i.symbol === 'MISSING' && i.message.match(/no bars/i)),
    ).toBeDefined();
  });

  it('warns on bars from symbols not in the requested universe', () => {
    const bars = [bar({ symbol: 'EXTRA', ts: 1_000 })];
    const r = validateBars(bars, ['SPY']);
    expect(
      r.issues.find((i) => i.symbol === 'EXTRA' && i.severity === 'warning'),
    ).toBeDefined();
  });

  it('surfaces a raw-adjustment caveat as a warning by default', () => {
    const r = validateBars([], [], 'raw');
    expect(r.issues.find((i) => i.message.match(/raw/i))).toBeDefined();
    expect(r.metadata.rawAdjustmentWarning).toBeDefined();
  });

  it('does not add raw caveat when adjustment is not raw', () => {
    const r = validateBars([], [], 'split');
    expect(r.issues.find((i) => i.message.match(/raw \(unadjusted\)/i))).toBeUndefined();
  });
});
