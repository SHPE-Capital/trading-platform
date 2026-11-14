import {
  allocateBatch,
  MinuteBatch,
  medianDailyDollarVolume,
  rankCandidates,
  type AccountState,
  type AllocatorAccountConfig,
  type BatchCandidate,
} from '../../strategies/momentum/batchAllocator';
import type { EntryIntent } from '../../strategies/momentum/breakoutMomentumTypes';

// Mirrors momentum_golden/s3_rank_size/weekly_config.json `account`.
const ACCOUNT: AllocatorAccountConfig = {
  max_positions: 3, per_stock_pct: 0.08, risk_pct: 0.0025, total_exposure_cap: 0.8,
  liquidity_cap_pct: 0.01, liquidity_lookback: 5, liquidity_min_obs: 2, cost_bps: 10,
  ranking: 'dollar_volume_20d', size_multiplier: null,
  exit: { initial_stop_atr: 1.5 }, fill: { limit_markup: 0.002 },
};

function cand(assetId: string, close: number, atr: number, dv: number, vols: number[] = [50_000, 50_000, 50_000]): BatchCandidate {
  const intent = {
    symbol: assetId.toUpperCase(), assetId, referenceClose: close, atr, limitPrice: null,
  } as unknown as EntryIntent;
  return { intent, dollarVolumeMedian: dv, sameMinuteVolumes: vols };
}

function state(p: Partial<AccountState> = {}): AccountState {
  return {
    equity: 100_000, cashFree: 100_000, exposureUsed: 0, openPositions: 0, pendingOrders: 0,
    enteredToday: new Set(), ...p,
  };
}

describe('allocateBatch (golden s3_rank_size values)', () => {
  it('fresh account: per_stock binds (decision 0)', () => {
    const r = allocateBatch([cand('a-0023', 25.83, 0.06527274772267598, 153866933.165, [248414, 248414])], state(), ACCOUNT);
    expect(r.orders).toHaveLength(1);
    const o = r.orders[0];
    expect(o.qty).toBe(309);
    expect(o.bindingCap).toBe('per_stock');
    expect(o.rank).toBe(0);
    expect(o.limitPrice).toBeCloseTo(25.88166, 9);
    expect(o.unitCost).toBeCloseTo(25.90754166, 8);
    expect(o.reserved).toBeCloseTo(8005.43037294, 6);
    expect(o.liquidityShares).toBeCloseTo(2484.14, 6);
  });

  it('ties rank by ascending assetId and max_positions rejects the second (decision 1)', () => {
    const st = state({ equity: 104250.5, cashFree: 38000, exposureUsed: 57500, openPositions: 2 });
    const r = allocateBatch(
      [cand('a-0021', 51.5, 0.12, 76784113.18), cand('a-0020', 51.53, 0.12292639268750398, 76784113.18, [45436, 45436, 45436])],
      st, ACCOUNT,
    );
    expect(r.candidates).toEqual(['a-0020', 'a-0021']);
    expect(r.orders.map((o) => [o.assetId, o.qty, o.bindingCap])).toEqual([['a-0020', 161, 'per_stock']]);
    expect(r.orders[0].reserved).toBeCloseTo(8321.23558266, 6);
    expect(r.rejections).toEqual([{ assetId: 'a-0021', symbol: 'A-0021', reason: 'max_positions' }]);
  });

  it('cash binds, then the next candidate is size_zero:cash (decision 2)', () => {
    const st = state({ cashFree: 1500, exposureUsed: 20000, openPositions: 1 });
    const r = allocateBatch(
      [cand('a-0020', 51.61, 0.12343165035268194, 76784113.18, [56216, 56216, 56216]), cand('a-0021', 51.62, 0.12, 76784113.18)],
      st, ACCOUNT,
    );
    expect(r.orders.map((o) => [o.assetId, o.qty, o.bindingCap])).toEqual([['a-0020', 28, 'cash']]);
    expect(r.orders[0].reserved).toBeCloseTo(1449.41813016, 6);
    expect(r.rejections.map((x) => x.reason)).toEqual(['size_zero:cash']);
  });

  it('drops entered-today assets without a rejection (decision 3)', () => {
    const r = allocateBatch(
      [cand('a-0020', 51.6, 0.12, 76784113.18), cand('a-0021', 51.69, 0.11674538477581659, 76784113.18, [45062.5, 45062.5, 45062.5])],
      state({ equity: 99000, cashFree: 99000, enteredToday: new Set(['a-0020']) }), ACCOUNT,
    );
    expect(r.candidates).toEqual(['a-0021']);
    expect(r.orders[0].qty).toBe(153);
    expect(r.rejections).toEqual([]);
  });
});

describe('allocateBatch rules', () => {
  it('ranks by descending dollar volume, ahead of asset id', () => {
    const r = rankCandidates([cand('a-1', 10, 1, 5), cand('a-2', 10, 1, 9), cand('a-0', 10, 1, 5)], 'dollar_volume_20d');
    expect(r.map((c) => c.intent.assetId)).toEqual(['a-2', 'a-0', 'a-1']);
  });

  it('rejects an unknown ranking', () => {
    expect(() => allocateBatch([cand('a', 10, 1, 1)], state(), { ...ACCOUNT, ranking: 'nope' })).toThrow(/unknown ranking/);
  });

  it('caps a batch with more candidates than capacity in rank order', () => {
    const cs = ['a-1', 'a-2', 'a-3', 'a-4', 'a-5'].map((id, i) => cand(id, 10, 0.05, 1000 + i));
    const r = allocateBatch(cs, state({ openPositions: 1 }), ACCOUNT);
    expect(r.orders.map((o) => o.assetId)).toEqual(['a-5', 'a-4']);
    expect(r.rejections.map((x) => [x.assetId, x.reason])).toEqual([
      ['a-3', 'max_positions'], ['a-2', 'max_positions'], ['a-1', 'max_positions'],
    ]);
  });

  it('pending notional from earlier orders shrinks exposure room', () => {
    const cfg = { ...ACCOUNT, max_positions: 10 };
    const big = [1e6, 1e6, 1e6];
    const r = allocateBatch(
      [cand('a-1', 10, 0.05, 2, big), cand('a-2', 10, 0.05, 1, big)],
      state({ exposureUsed: 73_000 }), cfg,
    );
    expect(r.orders[0]).toMatchObject({ assetId: 'a-1', qty: 700, bindingCap: 'exposure' });
    expect(r.rejections.map((x) => x.reason)).toEqual(['size_zero:exposure']);
  });

  it('bad_data for non-positive ATR or non-finite price', () => {
    const r = allocateBatch([cand('a-1', 10, 0, 1), cand('a-2', NaN, 1, 0)], state(), ACCOUNT);
    expect(r.rejections.map((x) => x.reason)).toEqual(['bad_data', 'bad_data']);
  });

  it('liquidity binds and too few observations gives size_zero:liquidity', () => {
    const r = allocateBatch([cand('a-1', 10, 0.05, 2, [10_000, 10_000]), cand('a-2', 10, 0.05, 1, [10_000])], state(), ACCOUNT);
    expect(r.orders[0]).toMatchObject({ qty: 100, bindingCap: 'liquidity' });
    expect(r.rejections[0].reason).toBe('size_zero:liquidity');
  });

  it('size_multiplier scales the equity caps', () => {
    const r = allocateBatch([cand('a-1', 10, 0.05, 1, [1e9, 1e9, 1e9])], state(), { ...ACCOUNT, size_multiplier: 0.5 });
    expect(r.orders[0]).toMatchObject({ qty: 400, bindingCap: 'per_stock' });
  });

  it('is deterministic regardless of input order', () => {
    const cs = [cand('a-1', 10, 0.05, 3), cand('a-2', 10, 0.05, 3), cand('a-3', 10, 0.05, 4)];
    expect(allocateBatch([...cs].reverse(), state(), ACCOUNT)).toEqual(allocateBatch(cs, state(), ACCOUNT));
  });
});

describe('medianDailyDollarVolume', () => {
  it('uses the last lookback sessions and averages the middle pair', () => {
    expect(medianDailyDollarVolume([100, 1, 2, 3, 4], 4)).toBe(2.5);
    expect(medianDailyDollarVolume([], 5)).toBe(0);
  });
});

describe('MinuteBatch', () => {
  it('excludes bars arriving more than 1 s after the minute end and records them', () => {
    const b = new MinuteBatch(60_000);
    expect(b.add(cand('a-1', 10, 1, 1), 60_500)).toBe(true);
    expect(b.add(cand('a-2', 10, 1, 1), 61_000)).toBe(true);
    expect(b.add(cand('a-3', 10, 1, 1), 61_001)).toBe(false);
    expect(b.close().map((c) => c.intent.assetId)).toEqual(['a-1', 'a-2']);
    expect(b.late).toEqual([{ symbol: 'A-3', receivedAtMs: 61_001, lateByMs: 1 }]);
    expect(b.add(cand('a-4', 10, 1, 1), 60_001)).toBe(false);
  });
});
