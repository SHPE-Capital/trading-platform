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
  getAllOrders,
  insertFill,
  insertPortfolioSnapshot,
  getLatestPortfolioSnapshot,
  getPortfolioEquityCurve,
  insertStrategyRun,
  updateStrategyRun,
  getAllStrategyRuns,
  getStrategyRunById,
  insertBacktestResult,
  insertBacktestOrders,
  insertBacktestFills,
  getAllBacktestResults,
  getBacktestResultById,
  updateBacktestResultStatus,
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
const mockOrder = { id: 'order-1', symbol: 'SPY', submittedAt: 1_000_000, updatedAt: 1_000_000 } as Order;
const mockFill = { id: 'fill-1', symbol: 'SPY', ts: 1_000_000 } as Fill;
const mockSnapshot = { id: 'snap-1', equity: 100_000, ts: 1_000_000 } as PortfolioSnapshot;
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
    expect(payload).toMatchObject({ id: mockOrder.id, symbol: mockOrder.symbol, is_paper: true });
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
const dbOrderRow = {
  id: 'o1',
  broker_order_id: 'broker-123',
  intent_id: 'intent-1',
  strategy_id: 'run-1',
  symbol: 'SPY',
  side: 'buy',
  qty: 10,
  filled_qty: 10,
  avg_fill_price: 500,
  order_type: 'market',
  limit_price: null,
  stop_price: null,
  time_in_force: 'day',
  status: 'filled',
  submitted_at: '1970-01-01T00:16:40.000Z',
  updated_at: '1970-01-01T00:16:40.000Z',
  closed_at: null,
  meta: null,
};

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

  it('maps snake_case DB columns to camelCase Order fields', async () => {
    const chain = buildChain({
      order: jest.fn().mockResolvedValue({ data: [dbOrderRow], error: null }),
    });
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getOrdersByStrategyRun('run-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'o1',
      brokerOrderId: 'broker-123',
      intentId: 'intent-1',
      strategyId: 'run-1',
      symbol: 'SPY',
      side: 'buy',
      qty: 10,
      filledQty: 10,
      avgFillPrice: 500,
      orderType: 'market',
      timeInForce: 'day',
      status: 'filled',
      submittedAt: 1_000_000,
    });
    // No raw snake_case keys leak through
    const raw = result[0] as unknown as Record<string, unknown>;
    expect(raw['broker_order_id']).toBeUndefined();
    expect(raw['strategy_id']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getAllOrders
// ---------------------------------------------------------------------------
describe('getAllOrders', () => {
  it('returns empty array on error', async () => {
    const chain = buildChain({
      limit: jest.fn().mockResolvedValue({ data: null, error: { message: 'err' } }),
    });
    chain.select.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getAllOrders();
    expect(result).toEqual([]);
  });

  it('maps rows and passes the limit argument', async () => {
    const limitFn = jest.fn().mockResolvedValue({ data: [dbOrderRow], error: null });
    const chain = buildChain({ limit: limitFn });
    chain.select.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getAllOrders(100);
    expect(limitFn).toHaveBeenCalledWith(100);
    expect(result).toHaveLength(1);
    expect(result[0].brokerOrderId).toBe('broker-123');
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
    expect(payload).toMatchObject({ id: mockFill.id, symbol: mockFill.symbol, is_paper: true });
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
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ id: 'snap-1', equity: 100_000 }));
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

  it('returns a mapped snapshot on success', async () => {
    // Simulate the snake_case row that Supabase actually returns
    const dbRow = {
      id: 'snap-1',
      ts: '1970-01-01T00:16:40.000Z', // EpochMs 1_000_000 as ISO string
      equity: 100_000,
      cash: 50_000,
      positions_value: 50_000,
      initial_capital: 100_000,
      total_unrealized_pnl: 0,
      total_realized_pnl: 0,
      total_pnl: 0,
      return_pct: 0,
      positions: [],
      position_count: 0,
    };
    const chain = buildChain({
      single: jest.fn().mockResolvedValue({ data: dbRow, error: null }),
    });
    chain.select.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getLatestPortfolioSnapshot();
    expect(result).toEqual(expect.objectContaining({
      id: 'snap-1',
      ts: 1_000_000,
      isoTs: '1970-01-01T00:16:40.000Z',
      equity: 100_000,
      cash: 50_000,
      positionsValue: 50_000,
      initialCapital: 100_000,
    }));
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
    const [payload] = chain.insert.mock.calls[0];
    // Repository maps camelCase StrategyRun → snake_case DB columns
    expect(payload.id).toBe(mockStrategyRun.id);
    expect(payload.strategy_id).toBe(mockStrategyRun.strategyId);
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
    // DB returns snake_case rows; repository maps them to camelCase StrategyRun objects
    const dbRow = {
      id: 'run-1', strategy_id: 'strat-1', strategy_type: 'pairs_trading',
      name: 'test', config: {}, status: 'running', execution_mode: 'paper',
      started_at: new Date(1_000_000).toISOString(),
      total_signals: 0, total_orders: 0, realized_pnl: 0,
    };
    const chain = buildChain({
      order: jest.fn().mockResolvedValue({ data: [dbRow], error: null }),
    });
    chain.select.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getAllStrategyRuns();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      id: 'run-1',
      strategyId: 'strat-1',
      strategyType: 'pairs_trading',
      status: 'running',
    }));
  });
});

// ---------------------------------------------------------------------------
// getStrategyRunById
// ---------------------------------------------------------------------------
describe('getStrategyRunById', () => {
  it('returns null when the row is not found (PGRST116)', async () => {
    const chain = buildChain({
      single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'not found' } }),
    });
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getStrategyRunById('missing-id');
    expect(result).toBeNull();
  });

  it('returns a mapped StrategyRun on success', async () => {
    const dbRow = {
      id: 'run-1', strategy_id: 'strat-1', strategy_type: 'pairs_trading',
      name: 'test', config: {}, status: 'running', execution_mode: 'paper',
      started_at: '1970-01-01T00:16:40.000Z',
      total_signals: 5, total_orders: 2, realized_pnl: 100,
    };
    const chain = buildChain({
      single: jest.fn().mockResolvedValue({ data: dbRow, error: null }),
    });
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getStrategyRunById('run-1');
    expect(result).toMatchObject({
      id: 'run-1',
      strategyId: 'strat-1',
      startedAt: 1_000_000,
      totalSignals: 5,
    });
  });

  it('returns undefined startedAt when started_at is null', async () => {
    const dbRow = {
      id: 'run-2', strategy_id: 'strat-1', strategy_type: 'pairs_trading',
      name: 'test', config: {}, status: 'running', execution_mode: 'paper',
      started_at: null,
      total_signals: 0, total_orders: 0, realized_pnl: 0,
    };
    const chain = buildChain({
      single: jest.fn().mockResolvedValue({ data: dbRow, error: null }),
    });
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);
    const result = await getStrategyRunById('run-2');
    expect(result).not.toBeNull();
    expect(result!.startedAt).toBeUndefined();
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

// ---------------------------------------------------------------------------
// updateBacktestResultStatus
// ---------------------------------------------------------------------------
describe('updateBacktestResultStatus', () => {
  it('calls from("backtest_results").update({ status }).eq("id", id)', async () => {
    const chain = buildChain({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });
    chain.update.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);

    await updateBacktestResultStatus('bt-1', 'failed');

    expect(mockFrom).toHaveBeenCalledWith('backtest_results');
    expect(chain.update).toHaveBeenCalledWith({ status: 'failed' });
    expect(chain.eq).toHaveBeenCalledWith('id', 'bt-1');
  });

  it('does not throw when the update returns an error', async () => {
    const chain = buildChain({
      eq: jest.fn().mockResolvedValue({ error: { message: 'update failed' } }),
    });
    chain.update.mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);

    await expect(updateBacktestResultStatus('bt-1', 'failed')).resolves.toBeUndefined();
  });
});
