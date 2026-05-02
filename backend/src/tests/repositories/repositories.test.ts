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
  started_at: Date.now(), 
  completed_at: Date.now(),
  metrics: { totalReturnPct: 0 },
  final_portfolio: { equity: 100000 },
  equity_curve: []
} as any;

// ---------------------------------------------------------------------------
// insertOrder
// ---------------------------------------------------------------------------
describe('insertOrder', () => {
  it('calls from("orders").insert(order)', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await insertOrder(mockOrder);
    expect(mockFrom).toHaveBeenCalledWith('orders');
    expect(chain.insert).toHaveBeenCalledWith(mockOrder);
  });

  it('does not throw on Supabase error', async () => {
    const chain = buildChain({
      insert: jest.fn().mockResolvedValue({ error: { message: 'DB error' } }),
    });
    mockFrom.mockReturnValue(chain);
    await expect(insertOrder(mockOrder)).resolves.toBeUndefined();
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
  it('calls from("fills").insert(fill)', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await insertFill(mockFill);
    expect(mockFrom).toHaveBeenCalledWith('fills');
    expect(chain.insert).toHaveBeenCalledWith(mockFill);
  });

  it('does not throw on error', async () => {
    const chain = buildChain({
      insert: jest.fn().mockResolvedValue({ error: { message: 'err' } }),
    });
    mockFrom.mockReturnValue(chain);
    await expect(insertFill(mockFill)).resolves.toBeUndefined();
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
// insertBacktestResult
// ---------------------------------------------------------------------------
describe('insertBacktestResult', () => {
  it('calls from("backtest_results").insert(result) with formatted dates', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await insertBacktestResult(mockBacktestResult);
    expect(mockFrom).toHaveBeenCalledWith('backtest_results');
    
    // The repository formats dates to ISO strings before inserting
    const expectedPayload = {
      ...mockBacktestResult,
      started_at: new Date(mockBacktestResult.started_at).toISOString(),
      completed_at: new Date(mockBacktestResult.completed_at).toISOString(),
      equity_curve: [], // downsampled from empty
    };
    expect(chain.insert).toHaveBeenCalledWith(expectedPayload);
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
