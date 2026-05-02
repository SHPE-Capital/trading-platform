// Mock the Supabase client and env before any imports
jest.mock('../../adapters/supabase/client');
jest.mock('../../config/env', () => ({
  env: {
    supabaseUrl: 'https://test.supabase.co',
    supabaseAnonKey: 'test-anon-key',
    supabaseServiceRoleKey: 'test-service-key',
    alpacaApiKey: 'test-key',
    alpacaApiSecret: 'test-secret',
    alpacaTradingMode: 'paper',
    alpacaPaperBaseUrl: 'https://paper-api.alpaca.markets',
    alpacaLiveBaseUrl: 'https://api.alpaca.markets',
    alpacaDataStreamUrl: 'wss://stream.data.alpaca.markets/v2',
    alpacaPaperStreamUrl: 'wss://paper-api.alpaca.markets/stream',
    alpacaLiveStreamUrl: 'wss://api.alpaca.markets/stream',
    port: 8080,
    nodeEnv: 'test',
    corsOrigin: 'http://localhost:3000',
    logLevel: 'error',
    defaultRollingWindowMs: 60_000,
    maxPositionSizeUsd: 10_000,
    maxNotionalExposureUsd: 50_000,
    orderCooldownMs: 5_000,
    enableLiveTrading: false,
    enableWebSocketPush: true,
    databaseUrl: '',
  },
}));

import { getSupabaseClient } from '../../adapters/supabase/client';
import {
  insertOrder,
  updateOrder,
  getOrdersByStrategyRun,
  insertFill,
  insertPortfolioSnapshot,
  getLatestPortfolioSnapshot,
  getPortfolioEquityCurve,
  insertStrategyRun,
  updateStrategyRun,
  getAllStrategyRuns,
  insertBacktestResult,
  insertBacktestOrders,
  insertBacktestFills,
  getAllBacktestResults,
  getBacktestResultById,
} from '../../adapters/supabase/repositories';
import type { Order, Fill } from '../../types/orders';
import type { PortfolioSnapshot } from '../../types/portfolio';
import type { StrategyRun } from '../../types/strategy';
import type { BacktestResult } from '../../types/backtest';

// -------------------------------------------------------------------------
// Build a chainable mock that covers all Supabase query builder patterns
// -------------------------------------------------------------------------
function buildChain(overrides: Record<string, jest.Mock> = {}) {
  const chain: Record<string, jest.Mock> = {
    insert: jest.fn().mockResolvedValue({ error: null }),
    update: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
  // Make update().eq() chain work: update returns the chain
  chain.update.mockReturnValue(chain);
  return chain;
}

const mockFrom = jest.fn();
(getSupabaseClient as jest.Mock).mockReturnValue({ from: mockFrom });

beforeEach(() => {
  jest.clearAllMocks();
  (getSupabaseClient as jest.Mock).mockReturnValue({ from: mockFrom });
});

// ---------------------------------------------------------------------------
// Helpers — minimal domain objects
// ---------------------------------------------------------------------------
const mockOrder = { id: 'order-1', symbol: 'SPY' } as Order;
const mockFill = { id: 'fill-1', symbol: 'SPY' } as Fill;
const mockSnapshot = { id: 'snap-1', equity: 100_000 } as PortfolioSnapshot;
const mockStrategyRun = { id: 'run-1', strategyId: 'strat-1' } as StrategyRun;
const mockBacktestResult = {
  id: 'bt-1',
  equity_curve: [],
  orders: [],
  fills: [],
  started_at: 1_000_000,
  completed_at: 2_000_000,
} as unknown as BacktestResult;

// ---------------------------------------------------------------------------
// insertOrder
// ---------------------------------------------------------------------------
describe('insertOrder', () => {
  it('defaults is_paper to true (fail-safe)', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await insertOrder(mockOrder);
    expect(mockFrom).toHaveBeenCalledWith('orders');
    const [payload] = chain.insert.mock.calls[0];
    expect(payload).toMatchObject({ ...mockOrder, is_paper: true });
  });

  it('passes is_paper=false when explicitly requested (live trade)', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await insertOrder(mockOrder, false);
    const [payload] = chain.insert.mock.calls[0];
    expect(payload.is_paper).toBe(false);
  });

  it('does not throw on Supabase error', async () => {
    const chain = buildChain({
      insert: jest.fn().mockResolvedValue({ error: { message: 'DB error' } }),
    });
    mockFrom.mockReturnValue(chain);
    await expect(insertOrder(mockOrder, true)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// updateOrder
// ---------------------------------------------------------------------------
describe('updateOrder', () => {
  it('calls from("orders").update(updates).eq("id", id)', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await updateOrder('order-1', { status: 'filled' } as Partial<Order>);
    expect(mockFrom).toHaveBeenCalledWith('orders');
    expect(chain.update).toHaveBeenCalledWith({ status: 'filled' });
    expect(chain.eq).toHaveBeenCalledWith('id', 'order-1');
  });
});

// ---------------------------------------------------------------------------
// getOrdersByStrategyRun
// ---------------------------------------------------------------------------
describe('getOrdersByStrategyRun', () => {
  it('returns empty array on error', async () => {
    const chain = buildChain({
      order: jest.fn().mockResolvedValue({ data: null, error: { message: 'err' } }),
    });
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getOrdersByStrategyRun('run-1');
    expect(result).toEqual([]);
  });

  it('returns data array on success', async () => {
    const orders = [{ id: 'o1' }, { id: 'o2' }];
    const chain = buildChain({
      order: jest.fn().mockResolvedValue({ data: orders, error: null }),
    });
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getOrdersByStrategyRun('run-1');
    expect(result).toEqual(orders);
  });
});

// ---------------------------------------------------------------------------
// insertFill
// ---------------------------------------------------------------------------
describe('insertFill', () => {
  it('defaults is_paper to true (fail-safe)', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await insertFill(mockFill);
    expect(mockFrom).toHaveBeenCalledWith('fills');
    const [payload] = chain.insert.mock.calls[0];
    expect(payload).toMatchObject({ ...mockFill, is_paper: true });
  });

  it('passes is_paper=false when explicitly requested (live trade)', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await insertFill(mockFill, false);
    const [payload] = chain.insert.mock.calls[0];
    expect(payload.is_paper).toBe(false);
  });

  it('does not throw on error', async () => {
    const chain = buildChain({
      insert: jest.fn().mockResolvedValue({ error: { message: 'err' } }),
    });
    mockFrom.mockReturnValue(chain);
    await expect(insertFill(mockFill, true)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// insertPortfolioSnapshot
// ---------------------------------------------------------------------------
describe('insertPortfolioSnapshot', () => {
  it('calls from("portfolio_snapshots").insert(snapshot)', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await insertPortfolioSnapshot(mockSnapshot);
    expect(mockFrom).toHaveBeenCalledWith('portfolio_snapshots');
    expect(chain.insert).toHaveBeenCalledWith(mockSnapshot);
  });
});

// ---------------------------------------------------------------------------
// getLatestPortfolioSnapshot
// ---------------------------------------------------------------------------
describe('getLatestPortfolioSnapshot', () => {
  it('returns null on error', async () => {
    const chain = buildChain({
      single: jest.fn().mockResolvedValue({ data: null, error: { message: 'err' } }),
    });
    chain.select.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getLatestPortfolioSnapshot();
    expect(result).toBeNull();
  });

  it('returns snapshot on success', async () => {
    const chain = buildChain({
      single: jest.fn().mockResolvedValue({ data: mockSnapshot, error: null }),
    });
    chain.select.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getLatestPortfolioSnapshot();
    expect(result).toEqual(mockSnapshot);
  });
});

// ---------------------------------------------------------------------------
// getPortfolioEquityCurve
// ---------------------------------------------------------------------------
describe('getPortfolioEquityCurve', () => {
  it('returns empty array on error', async () => {
    const limitFn = jest.fn().mockResolvedValue({ data: null, error: { message: 'err' } });
    const chain = buildChain({ limit: limitFn });
    chain.select.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getPortfolioEquityCurve();
    expect(result).toEqual([]);
  });

  it('passes the limit argument', async () => {
    const limitFn = jest.fn().mockResolvedValue({ data: [], error: null });
    const chain = buildChain({ limit: limitFn });
    chain.select.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    await getPortfolioEquityCurve(200);
    expect(limitFn).toHaveBeenCalledWith(200);
  });
});

// ---------------------------------------------------------------------------
// insertStrategyRun
// ---------------------------------------------------------------------------
describe('insertStrategyRun', () => {
  it('calls from("strategy_runs").insert(run)', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await insertStrategyRun(mockStrategyRun);
    expect(mockFrom).toHaveBeenCalledWith('strategy_runs');
    expect(chain.insert).toHaveBeenCalledWith(mockStrategyRun);
  });
});

// ---------------------------------------------------------------------------
// updateStrategyRun
// ---------------------------------------------------------------------------
describe('updateStrategyRun', () => {
  it('calls from("strategy_runs").update(updates).eq("id", id)', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await updateStrategyRun('run-1', { status: 'stopped' } as Partial<StrategyRun>);
    expect(chain.update).toHaveBeenCalledWith({ status: 'stopped' });
    expect(chain.eq).toHaveBeenCalledWith('id', 'run-1');
  });
});

// ---------------------------------------------------------------------------
// getAllStrategyRuns
// ---------------------------------------------------------------------------
describe('getAllStrategyRuns', () => {
  it('returns empty array on error', async () => {
    const chain = buildChain({
      order: jest.fn().mockResolvedValue({ data: null, error: { message: 'err' } }),
    });
    chain.select.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getAllStrategyRuns();
    expect(result).toEqual([]);
  });

  it('returns array on success', async () => {
    const runs = [mockStrategyRun];
    const chain = buildChain({
      order: jest.fn().mockResolvedValue({ data: runs, error: null }),
    });
    chain.select.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getAllStrategyRuns();
    expect(result).toEqual(runs);
  });
});

// ---------------------------------------------------------------------------
// insertBacktestOrders
// ---------------------------------------------------------------------------
const mockBacktestOrder = {
  id: 'order-bt-1',
  strategyId: 'strat-1',
  symbol: 'SPY',
  side: 'buy',
  qty: 10,
  filledQty: 10,
  avgFillPrice: 500,
  orderType: 'market',
  limitPrice: undefined,
  stopPrice: undefined,
  status: 'filled',
  submittedAt: 1_000_000,
  closedAt: 1_001_000,
} as unknown as import('../../types/orders').Order;

describe('insertBacktestOrders', () => {
  it('writes to backtest_orders, not orders', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await insertBacktestOrders('bt-1', [mockBacktestOrder]);
    expect(mockFrom).toHaveBeenCalledWith('backtest_orders');
    expect(mockFrom).not.toHaveBeenCalledWith('orders');
  });

  it('payload has backtest_id and real strategy_id, omits broker-specific fields', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await insertBacktestOrders('bt-1', [mockBacktestOrder]);
    const [payload] = chain.insert.mock.calls[0];
    const row = payload[0];
    expect(row.backtest_id).toBe('bt-1');
    expect(row.strategy_id).toBe('strat-1');
    expect(row.broker_order_id).toBeUndefined();
    expect(row.intent_id).toBeUndefined();
    expect(row.time_in_force).toBeUndefined();
    expect(row.updated_at).toBeUndefined();
    expect(row.meta).toBeUndefined();
  });

  it('returns early without hitting Supabase when orders array is empty', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await insertBacktestOrders('bt-1', []);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('throws on Supabase error', async () => {
    const chain = buildChain({
      insert: jest.fn().mockResolvedValue({ error: { message: 'DB error' } }),
    });
    mockFrom.mockReturnValue(chain);
    await expect(insertBacktestOrders('bt-1', [mockBacktestOrder])).rejects.toThrow('Failed to insert backtest orders chunk');
  });
});

// ---------------------------------------------------------------------------
// insertBacktestFills
// ---------------------------------------------------------------------------
const mockBacktestFill = {
  id: 'fill-bt-1',
  orderId: 'order-bt-1',
  symbol: 'SPY',
  side: 'buy',
  qty: 10,
  price: 500,
  notional: 5000,
  commission: 0,
  ts: 1_000_000,
  isoTs: '2024-01-01T00:00:00.000Z',
  exchange: 'NYSE',
} as unknown as import('../../types/orders').Fill;

describe('insertBacktestFills', () => {
  it('writes to backtest_fills, not fills', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await insertBacktestFills('bt-1', [mockBacktestFill]);
    expect(mockFrom).toHaveBeenCalledWith('backtest_fills');
    expect(mockFrom).not.toHaveBeenCalledWith('fills');
  });

  it('payload has backtest_id and omits exchange', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await insertBacktestFills('bt-1', [mockBacktestFill]);
    const [payload] = chain.insert.mock.calls[0];
    const row = payload[0];
    expect(row.backtest_id).toBe('bt-1');
    expect(row.order_id).toBe('order-bt-1');
    expect(row.exchange).toBeUndefined();
  });

  it('returns early without hitting Supabase when fills array is empty', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await insertBacktestFills('bt-1', []);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('throws on Supabase error', async () => {
    const chain = buildChain({
      insert: jest.fn().mockResolvedValue({ error: { message: 'DB error' } }),
    });
    mockFrom.mockReturnValue(chain);
    await expect(insertBacktestFills('bt-1', [mockBacktestFill])).rejects.toThrow('Failed to insert backtest fills chunk');
  });
});

// ---------------------------------------------------------------------------
// insertBacktestResult
// ---------------------------------------------------------------------------
describe('insertBacktestResult', () => {
  it('calls from("backtest_results").insert() with orders/fills stripped', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await insertBacktestResult(mockBacktestResult);
    expect(mockFrom).toHaveBeenCalledWith('backtest_results');
    expect(chain.insert).toHaveBeenCalledTimes(1);
    const [payload] = chain.insert.mock.calls[0];
    expect(payload.id).toBe('bt-1');
    expect(payload.equity_curve).toEqual([]);
    expect(payload.orders).toBeUndefined();
    expect(payload.fills).toBeUndefined();
  });

  it('downsamples equity_curve to 5000 points when it exceeds the limit', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    const largeCurve = Array.from({ length: 6_000 }, (_, i) => ({ ts: i } as any));
    await insertBacktestResult({ ...mockBacktestResult, equity_curve: largeCurve });
    const [payload] = chain.insert.mock.calls[0];
    expect(payload.equity_curve).toHaveLength(5000);
    expect(payload.equity_curve[0]).toEqual(largeCurve[0]);
    expect(payload.equity_curve[4999]).toEqual(largeCurve[5999]);
  });

  it('passes equity_curve through unchanged when it is under the limit', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    const smallCurve = [{ ts: 1 } as any, { ts: 2 } as any];
    await insertBacktestResult({ ...mockBacktestResult, equity_curve: smallCurve });
    const [payload] = chain.insert.mock.calls[0];
    expect(payload.equity_curve).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// getAllBacktestResults
// ---------------------------------------------------------------------------
describe('getAllBacktestResults', () => {
  it('returns empty array on error', async () => {
    const chain = buildChain({
      order: jest.fn().mockResolvedValue({ data: null, error: { message: 'err' } }),
    });
    chain.select.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getAllBacktestResults();
    expect(result).toEqual([]);
  });

  it('returns array on success', async () => {
    const results = [mockBacktestResult];
    const chain = buildChain({
      order: jest.fn().mockResolvedValue({ data: results, error: null }),
    });
    chain.select.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getAllBacktestResults();
    expect(result).toEqual(results);
  });
});

// ---------------------------------------------------------------------------
// getBacktestResultById
// ---------------------------------------------------------------------------
describe('getBacktestResultById', () => {
  it('returns null on error', async () => {
    const chain = buildChain({
      single: jest.fn().mockResolvedValue({ data: null, error: { message: 'err' } }),
    });
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getBacktestResultById('bt-1');
    expect(result).toBeNull();
  });

  it('returns result on success', async () => {
    const chain = buildChain({
      single: jest.fn().mockResolvedValue({ data: mockBacktestResult, error: null }),
    });
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getBacktestResultById('bt-1');
    expect(result).toEqual(mockBacktestResult);
  });
});
