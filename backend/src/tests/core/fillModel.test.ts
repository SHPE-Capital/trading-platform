/**
 * fillModel.test.ts — exercises the pure FillModel module.
 *
 * Covers: reference price selection, slippage and half-spread, limit-order
 * honoring, volume participation cap, partial-fill policy, and rejection
 * cases (zero volume, invalid qty, missing limit, halt bars).
 */

import {
  evaluateFill,
  DEFAULT_FILL_MODEL,
  pickReferencePrice,
  type FillModelConfig,
} from '../../core/execution/fillModel';
import type { OrderIntent } from '../../types/orders';
import type { Bar } from '../../types/market';

function makeBar(overrides: Partial<Bar> = {}): Bar {
  return {
    symbol: 'SPY',
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 10_000,
    vwap: 100.25,
    ts: 1_000,
    isoTs: new Date(1_000).toISOString(),
    timeframe: '1Min',
    ...overrides,
  };
}

function makeIntent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    id: 'i1',
    strategyId: 's1',
    symbol: 'SPY',
    side: 'buy',
    qty: 10,
    orderType: 'market',
    timeInForce: 'ioc',
    ts: 1_000,
    ...overrides,
  };
}

describe('FillModel.pickReferencePrice', () => {
  it('picks open / close / vwap from the bar', () => {
    const bar = makeBar({ open: 10, close: 12, vwap: 11 });
    expect(pickReferencePrice(bar, 'next_open')).toBe(10);
    expect(pickReferencePrice(bar, 'next_close')).toBe(12);
    expect(pickReferencePrice(bar, 'next_vwap')).toBe(11);
  });

  it('falls back to open when vwap is undefined', () => {
    const bar = makeBar({ open: 10, vwap: undefined });
    expect(pickReferencePrice(bar, 'next_vwap')).toBe(10);
  });

  it('returns null on non-positive or non-finite reference price', () => {
    expect(pickReferencePrice(makeBar({ open: 0 }), 'next_open')).toBeNull();
    expect(pickReferencePrice(makeBar({ open: NaN }), 'next_open')).toBeNull();
  });
});

describe('FillModel.evaluateFill — happy path', () => {
  it('fills a market buy at next_open with adverse slippage + half-spread', () => {
    const cfg: FillModelConfig = {
      ...DEFAULT_FILL_MODEL,
      slippageBps: 10,
      halfSpreadBps: 5,
      volumeParticipationCap: 1,
    };
    const decision = evaluateFill(makeIntent({ side: 'buy' }), makeBar({ open: 100 }), cfg);
    expect(decision.outcome).toBe('filled');
    // Buy crosses ask: 100 * (1 + 5/10000) = 100.05, then +10 bps slippage = 100.05 * 1.001
    expect(decision.fillPrice).toBeCloseTo(100.05 * 1.001, 6);
    expect(decision.filledQty).toBe(10);
  });

  it('fills a market sell with adverse slippage + half-spread (other direction)', () => {
    const cfg: FillModelConfig = {
      ...DEFAULT_FILL_MODEL,
      slippageBps: 10,
      halfSpreadBps: 5,
      volumeParticipationCap: 1,
    };
    const decision = evaluateFill(makeIntent({ side: 'sell' }), makeBar({ open: 100 }), cfg);
    expect(decision.outcome).toBe('filled');
    expect(decision.fillPrice).toBeCloseTo(100 * (1 - 0.0005) * (1 - 0.001), 6);
  });
});

describe('FillModel.evaluateFill — limit orders', () => {
  it('rejects a buy limit when reference is above limit', () => {
    const intent = makeIntent({ orderType: 'limit', limitPrice: 99, side: 'buy' });
    const decision = evaluateFill(intent, makeBar({ open: 100 }), {
      ...DEFAULT_FILL_MODEL,
      halfSpreadBps: 0,
      slippageBps: 0,
      volumeParticipationCap: 1,
    });
    expect(decision.outcome).toBe('rejected');
    expect(decision.reason).toMatch(/limit/i);
  });
  it('fills a buy limit when reference is below limit', () => {
    const intent = makeIntent({ orderType: 'limit', limitPrice: 101, side: 'buy' });
    const decision = evaluateFill(intent, makeBar({ open: 100 }), {
      ...DEFAULT_FILL_MODEL,
      halfSpreadBps: 0,
      slippageBps: 0,
      volumeParticipationCap: 1,
    });
    expect(decision.outcome).toBe('filled');
    expect(decision.fillPrice).toBe(100);
  });
  it('rejects a limit order missing limitPrice', () => {
    const decision = evaluateFill(
      makeIntent({ orderType: 'limit', limitPrice: undefined }),
      makeBar({ open: 100 }),
    );
    expect(decision.outcome).toBe('rejected');
    expect(decision.reason).toMatch(/missing/i);
  });
});

describe('FillModel.evaluateFill — volume participation', () => {
  it('partially fills when qty exceeds participation cap (allowPartialFills=true)', () => {
    const cfg: FillModelConfig = {
      ...DEFAULT_FILL_MODEL,
      slippageBps: 0,
      halfSpreadBps: 0,
      volumeParticipationCap: 0.1,
      allowPartialFills: true,
    };
    const decision = evaluateFill(
      makeIntent({ qty: 5_000 }),
      makeBar({ volume: 10_000 }),
      cfg,
    );
    expect(decision.outcome).toBe('partial');
    expect(decision.filledQty).toBe(1_000); // 10% cap
    expect(decision.remainingQty).toBe(4_000);
  });

  it('rejects when qty exceeds cap and allowPartialFills=false', () => {
    const cfg: FillModelConfig = {
      ...DEFAULT_FILL_MODEL,
      volumeParticipationCap: 0.1,
      allowPartialFills: false,
    };
    const decision = evaluateFill(makeIntent({ qty: 5_000 }), makeBar({ volume: 10_000 }), cfg);
    expect(decision.outcome).toBe('rejected');
    expect(decision.reason).toMatch(/participation/i);
  });

  it('rejects when bar volume is zero (halt-bar / no liquidity)', () => {
    const decision = evaluateFill(makeIntent(), makeBar({ volume: 0 }));
    expect(decision.outcome).toBe('rejected');
    expect(decision.reason).toMatch(/volume/i);
  });

  it('disables the cap when participation >= 1 (full qty always fills)', () => {
    const decision = evaluateFill(
      makeIntent({ qty: 50_000 }),
      makeBar({ volume: 100 }),
      {
        ...DEFAULT_FILL_MODEL,
        slippageBps: 0,
        halfSpreadBps: 0,
        volumeParticipationCap: 1,
      },
    );
    expect(decision.outcome).toBe('filled');
    expect(decision.filledQty).toBe(50_000);
  });
});

describe('FillModel.evaluateFill — invalid inputs', () => {
  it('rejects zero or negative qty', () => {
    expect(evaluateFill(makeIntent({ qty: 0 }), makeBar()).outcome).toBe('rejected');
    expect(evaluateFill(makeIntent({ qty: -1 }), makeBar()).outcome).toBe('rejected');
  });

  it('rejects when reference price is invalid', () => {
    const decision = evaluateFill(makeIntent(), makeBar({ open: 0 }));
    expect(decision.outcome).toBe('rejected');
    expect(decision.reason).toMatch(/reference price/i);
  });
});
