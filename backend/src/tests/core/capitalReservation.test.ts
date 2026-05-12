jest.mock('../../config/env', () => ({
  env: {
    alpacaApiKey: 'k', alpacaApiSecret: 's', alpacaTradingMode: 'paper',
    alpacaPaperBaseUrl: '', alpacaLiveBaseUrl: '',
    alpacaDataStreamUrl: '', alpacaPaperStreamUrl: '', alpacaLiveStreamUrl: '',
    supabaseUrl: '', supabaseAnonKey: '', supabaseServiceRoleKey: '',
    port: 8080, nodeEnv: 'test', corsOrigin: '', logLevel: 'error',
    defaultRollingWindowMs: 60_000, maxPositionSizeUsd: 10_000,
    maxNotionalExposureUsd: 50_000, orderCooldownMs: 5_000,
    enableLiveTrading: false, enableWebSocketPush: false, databaseUrl: '',
  },
}));

import { CapitalReservationManager } from '../../core/oms/capitalReservation';
import type { OrderIntent } from '../../types/orders';

function makeIntent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    id: 'intent-1',
    strategyId: 'strat-1',
    symbol: 'SPY',
    side: 'buy',
    qty: 10,
    orderType: 'market',
    timeInForce: 'day',
    ts: 10_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// reserve
// ---------------------------------------------------------------------------
describe('CapitalReservationManager.reserve', () => {
  it('returns a receipt with reservationId and correct amount when cash is sufficient', () => {
    const mgr = new CapitalReservationManager();
    const result = mgr.reserve(makeIntent(), 5_000, 100_000);
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(5_000);
    expect(typeof result!.reservationId).toBe('string');
    expect(result!.reservationId.length).toBeGreaterThan(0);
  });

  it('increases the reserved total after a successful reservation', () => {
    const mgr = new CapitalReservationManager();
    mgr.reserve(makeIntent(), 5_000, 100_000);
    expect(mgr.getReservedTotal()).toBe(5_000);
  });

  it('returns null when worstCaseNotional is zero', () => {
    const mgr = new CapitalReservationManager();
    expect(mgr.reserve(makeIntent(), 0, 100_000)).toBeNull();
    expect(mgr.getReservedTotal()).toBe(0);
  });

  it('returns null when worstCaseNotional is negative', () => {
    const mgr = new CapitalReservationManager();
    expect(mgr.reserve(makeIntent(), -1_000, 100_000)).toBeNull();
  });

  it('returns null when totalCash is insufficient for the reservation', () => {
    const mgr = new CapitalReservationManager();
    expect(mgr.reserve(makeIntent(), 50_000, 10_000)).toBeNull();
    expect(mgr.getReservedTotal()).toBe(0);
  });

  it('returns null when existing reservations consume all available cash', () => {
    const mgr = new CapitalReservationManager();
    // First reservation uses $90k of $100k
    mgr.reserve(makeIntent({ id: 'i1' }), 90_000, 100_000);
    // Second reservation needs $20k but only $10k remains
    const second = mgr.reserve(makeIntent({ id: 'i2' }), 20_000, 100_000);
    expect(second).toBeNull();
    expect(mgr.getReservedTotal()).toBe(90_000);
  });

  it('allows a second reservation when combined total fits within cash', () => {
    const mgr = new CapitalReservationManager();
    mgr.reserve(makeIntent({ id: 'i1' }), 30_000, 100_000);
    const second = mgr.reserve(makeIntent({ id: 'i2' }), 30_000, 100_000);
    expect(second).not.toBeNull();
    expect(mgr.getReservedTotal()).toBe(60_000);
  });

  it('reserves the exact amount (uses worstCaseNotional, not qty * limitPrice)', () => {
    const mgr = new CapitalReservationManager();
    // Even if the intent has limitPrice=0 (old bug), the worstCaseNotional drives the amount
    const intent = makeIntent({ limitPrice: 0, qty: 100 });
    const result = mgr.reserve(intent, 7_500, 100_000);
    expect(result!.amount).toBe(7_500);
  });
});

// ---------------------------------------------------------------------------
// release
// ---------------------------------------------------------------------------
describe('CapitalReservationManager.release', () => {
  it('removes the reservation and reduces reserved total', () => {
    const mgr = new CapitalReservationManager();
    const receipt = mgr.reserve(makeIntent(), 5_000, 100_000)!;
    expect(mgr.getReservedTotal()).toBe(5_000);
    mgr.release(receipt.reservationId);
    expect(mgr.getReservedTotal()).toBe(0);
  });

  it('restores available cash after release', () => {
    const mgr = new CapitalReservationManager();
    const receipt = mgr.reserve(makeIntent(), 80_000, 100_000)!;
    expect(mgr.getAvailableCash(100_000)).toBe(20_000);
    mgr.release(receipt.reservationId);
    expect(mgr.getAvailableCash(100_000)).toBe(100_000);
  });

  it('does not throw when releasing an unknown reservationId', () => {
    const mgr = new CapitalReservationManager();
    expect(() => mgr.release('nonexistent-id')).not.toThrow();
  });

  it('only removes the targeted reservation when multiple exist', () => {
    const mgr = new CapitalReservationManager();
    const r1 = mgr.reserve(makeIntent({ id: 'i1' }), 10_000, 100_000)!;
    mgr.reserve(makeIntent({ id: 'i2' }), 20_000, 100_000);
    mgr.release(r1.reservationId);
    expect(mgr.getReservedTotal()).toBe(20_000);
  });
});

// ---------------------------------------------------------------------------
// getStrategyReservedAmount
// ---------------------------------------------------------------------------
describe('CapitalReservationManager.getStrategyReservedAmount', () => {
  it('returns 0 when no reservations exist for the strategy', () => {
    const mgr = new CapitalReservationManager();
    expect(mgr.getStrategyReservedAmount('strat-1')).toBe(0);
  });

  it('returns the sum of all reservations for the given strategy', () => {
    const mgr = new CapitalReservationManager();
    mgr.reserve(makeIntent({ id: 'i1', strategyId: 'strat-A' }), 10_000, 100_000);
    mgr.reserve(makeIntent({ id: 'i2', strategyId: 'strat-A' }), 15_000, 100_000);
    expect(mgr.getStrategyReservedAmount('strat-A')).toBe(25_000);
  });

  it('does not include reservations from other strategies', () => {
    const mgr = new CapitalReservationManager();
    mgr.reserve(makeIntent({ id: 'i1', strategyId: 'strat-A' }), 10_000, 100_000);
    mgr.reserve(makeIntent({ id: 'i2', strategyId: 'strat-B' }), 20_000, 100_000);
    expect(mgr.getStrategyReservedAmount('strat-A')).toBe(10_000);
    expect(mgr.getStrategyReservedAmount('strat-B')).toBe(20_000);
  });

  it('decreases after a reservation for that strategy is released', () => {
    const mgr = new CapitalReservationManager();
    const r = mgr.reserve(makeIntent({ strategyId: 'strat-A' }), 10_000, 100_000)!;
    mgr.release(r.reservationId);
    expect(mgr.getStrategyReservedAmount('strat-A')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getAvailableCash
// ---------------------------------------------------------------------------
describe('CapitalReservationManager.getAvailableCash', () => {
  it('returns totalCash unchanged when no reservations exist', () => {
    const mgr = new CapitalReservationManager();
    expect(mgr.getAvailableCash(100_000)).toBe(100_000);
  });

  it('returns totalCash minus all reserved amounts', () => {
    const mgr = new CapitalReservationManager();
    mgr.reserve(makeIntent({ id: 'i1' }), 10_000, 100_000);
    mgr.reserve(makeIntent({ id: 'i2' }), 25_000, 100_000);
    expect(mgr.getAvailableCash(100_000)).toBe(65_000);
  });
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------
describe('CapitalReservationManager.clear', () => {
  it('removes all reservations and resets reserved total to 0', () => {
    const mgr = new CapitalReservationManager();
    mgr.reserve(makeIntent({ id: 'i1' }), 10_000, 100_000);
    mgr.reserve(makeIntent({ id: 'i2' }), 20_000, 100_000);
    expect(mgr.getReservedTotal()).toBe(30_000);
    mgr.clear();
    expect(mgr.getReservedTotal()).toBe(0);
    expect(mgr.getAvailableCash(100_000)).toBe(100_000);
  });
});

// ---------------------------------------------------------------------------
// Double-spend prevention (integration scenario)
// ---------------------------------------------------------------------------
describe('CapitalReservationManager: double-spend prevention', () => {
  it('two concurrent orders from the same strategy cannot both reserve beyond total cash', () => {
    const mgr = new CapitalReservationManager();
    const totalCash = 100_000;
    // Order A reserves 60% of cash
    const rA = mgr.reserve(makeIntent({ id: 'order-A', strategyId: 'strat-1' }), 60_000, totalCash);
    // Order B attempts to reserve 50% — would total 110% → blocked
    const rB = mgr.reserve(makeIntent({ id: 'order-B', strategyId: 'strat-1' }), 50_000, totalCash);
    expect(rA).not.toBeNull();
    expect(rB).toBeNull();
    expect(mgr.getReservedTotal()).toBe(60_000);
  });

  it('releasing the first order allows the second to proceed', () => {
    const mgr = new CapitalReservationManager();
    const totalCash = 100_000;
    const rA = mgr.reserve(makeIntent({ id: 'order-A' }), 60_000, totalCash)!;
    // Order B blocked while A is pending
    expect(mgr.reserve(makeIntent({ id: 'order-B' }), 50_000, totalCash)).toBeNull();
    // A fills (or cancels) → release
    mgr.release(rA.reservationId);
    // Now B can go through
    const rB = mgr.reserve(makeIntent({ id: 'order-B' }), 50_000, totalCash);
    expect(rB).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sell order reservations (Copilot fix — zero-amount bookkeeping)
// ---------------------------------------------------------------------------
describe('CapitalReservationManager: sell order reservations', () => {
  it('returns a non-null receipt with amount=0 for sell intents', () => {
    const mgr = new CapitalReservationManager();
    const receipt = mgr.reserve(makeIntent({ side: 'sell', qty: 50 }), 5_000, 100_000);
    expect(receipt).not.toBeNull();
    expect(receipt!.amount).toBe(0);
    expect(typeof receipt!.reservationId).toBe('string');
    expect(receipt!.reservationId.length).toBeGreaterThan(0);
  });

  it('does not reduce getAvailableCash after a sell reservation', () => {
    const mgr = new CapitalReservationManager();
    mgr.reserve(makeIntent({ side: 'sell', qty: 50 }), 5_000, 100_000);
    expect(mgr.getAvailableCash(100_000)).toBe(100_000);
  });

  it('does not increase getReservedTotal after a sell reservation', () => {
    const mgr = new CapitalReservationManager();
    mgr.reserve(makeIntent({ side: 'sell', qty: 50 }), 5_000, 100_000);
    expect(mgr.getReservedTotal()).toBe(0);
  });

  it('does not count toward strategy reserved amount', () => {
    const mgr = new CapitalReservationManager();
    mgr.reserve(makeIntent({ side: 'sell', qty: 50, strategyId: 'strat-A' }), 5_000, 100_000);
    expect(mgr.getStrategyReservedAmount('strat-A')).toBe(0);
  });

  it('can be released without error and leaves cash unchanged', () => {
    const mgr = new CapitalReservationManager();
    const receipt = mgr.reserve(makeIntent({ side: 'sell', qty: 50 }), 5_000, 100_000)!;
    expect(() => mgr.release(receipt.reservationId)).not.toThrow();
    expect(mgr.getAvailableCash(100_000)).toBe(100_000);
    expect(mgr.getReservedTotal()).toBe(0);
  });

  it('mixed buy and sell reservations: only buy reduces available cash', () => {
    const mgr = new CapitalReservationManager();
    mgr.reserve(makeIntent({ id: 'buy-1', side: 'buy' }), 30_000, 100_000);
    mgr.reserve(makeIntent({ id: 'sell-1', side: 'sell', qty: 100 }), 10_000, 100_000);
    expect(mgr.getReservedTotal()).toBe(30_000);
    expect(mgr.getAvailableCash(100_000)).toBe(70_000);
  });
});
