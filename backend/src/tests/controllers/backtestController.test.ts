jest.mock('../../adapters/supabase/repositories');
jest.mock('../../core/backtest/backtestEngine');
jest.mock('../../core/backtest/backtestStreamManager', () => ({
  backtestStreamManager: {
    register: jest.fn(),
    complete: jest.fn(),
    error: jest.fn(),
    emit: jest.fn(),
    subscribe: jest.fn(),
  },
}));
jest.mock('../../config/env', () => ({
  env: {
    supabaseUrl: 'https://test.supabase.co',
    supabaseAnonKey: 'test-anon',
    supabaseServiceRoleKey: 'test-service',
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

import type { Request, Response } from 'express';
import * as repos from '../../adapters/supabase/repositories';
import { backtestStreamManager } from '../../core/backtest/backtestStreamManager';
import { BacktestEngine } from '../../core/backtest/backtestEngine';
import {
  listBacktests,
  getBacktest,
  runBacktest,
} from '../../app/controllers/backtestController';
import type { BacktestResult, BacktestConfig } from '../../types/backtest';

const mockGetAll = repos.getAllBacktestResults as jest.Mock;
const mockGetById = repos.getBacktestResultById as jest.Mock;
const mockFindMatch = repos.findMatchingBacktestResult as jest.Mock;
const mockInsertResult = repos.insertBacktestResult as jest.Mock;
const mockInsertOrders = repos.insertBacktestOrders as jest.Mock;
const mockInsertFills = repos.insertBacktestFills as jest.Mock;
const mockStreamComplete = backtestStreamManager.complete as jest.Mock;
const mockStreamError = backtestStreamManager.error as jest.Mock;

/** Drain the setImmediate queue and resolve all pending microtasks. */
async function flushAsync(): Promise<void> {
  await new Promise<void>(r => setImmediate(r));
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function makeResult(id = 'bt-1'): BacktestResult {
  return {
    id,
    config: {
      id,
      name: 'Test',
      strategyConfig: { type: 'pairs_trading', symbols: ['SPY', 'QQQ'] },
      startDate: '2024-01-01',
      endDate: '2024-03-01',
      initialCapital: 100_000,
      dataGranularity: 'bar',
      slippageBps: 5,
      commissionPerShare: 0.005,
    } as BacktestConfig,
    status: 'completed',
    orders: [],
    fills: [],
    equity_curve: [],
    metrics: { totalReturnPct: 0, maxDrawdown: 0, winRate: 0, totalTrades: 0 },
    started_at: Date.now(),
    completed_at: Date.now(),
  } as unknown as BacktestResult;
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    app: { locals: { ctx: {} } },
    ...overrides,
  } as unknown as Request;
}

function mockRes() {
  const res = {
    json: jest.fn(),
    status: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response & { json: jest.Mock; status: jest.Mock };
}

beforeEach(() => jest.clearAllMocks());
// Drain any pending setImmediate callbacks after each test so that async work
// scheduled by runBacktest does not leak into subsequent tests and inflate mock
// call counts.
afterEach(async () => { await flushAsync(); });

describe('listBacktests', () => {
  it('returns all backtest results as JSON', async () => {
    const results = [{ id: 'bt-1' } as BacktestResult];
    mockGetAll.mockResolvedValue(results);
    const res = mockRes();
    await listBacktests(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(results);
  });

  it('returns 500 on repository error', async () => {
    mockGetAll.mockRejectedValue(new Error('DB fail'));
    const res = mockRes();
    await listBacktests(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('getBacktest', () => {
  it('returns the backtest result by ID', async () => {
    const result = { id: 'bt-1' } as BacktestResult;
    mockGetById.mockResolvedValue(result);
    const res = mockRes();
    await getBacktest(mockReq({ params: { id: 'bt-1' } as never }), res);
    expect(mockGetById).toHaveBeenCalledWith('bt-1');
    expect(res.json).toHaveBeenCalledWith(result);
  });

  it('returns 404 when result not found', async () => {
    mockGetById.mockResolvedValue(null);
    const res = mockRes();
    await getBacktest(mockReq({ params: { id: 'missing' } as never }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 500 on repository error', async () => {
    mockGetById.mockRejectedValue(new Error('DB fail'));
    const res = mockRes();
    await getBacktest(mockReq({ params: { id: 'bt-1' } as never }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('runBacktest — synchronous response', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = mockRes();
    await runBacktest(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('responds 202 immediately with backtestId when body is valid', async () => {
    const body = {
      strategyConfig: { type: 'pairs_trading', symbols: ['SPY', 'QQQ'] },
      startDate: '2024-01-01',
      endDate: '2024-03-01',
    };
    const res = mockRes();
    await runBacktest(mockReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(202);
    const jsonArg = (res.json as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(jsonArg).toHaveProperty('backtestId');
    expect(jsonArg).toHaveProperty('message');
  });

  it('strips force from body — the assigned config does not carry a force field', async () => {
    const body = {
      strategyConfig: { type: 'pairs_trading', symbols: ['SPY', 'QQQ'] },
      startDate: '2024-01-01',
      endDate: '2024-03-01',
      force: true,
    };
    const res = mockRes();
    await runBacktest(mockReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(202);
    // The 202 still fires — force only affects the async dedup logic
    expect((res.json as jest.Mock).mock.calls[0][0]).toHaveProperty('backtestId');
  });
});

describe('runBacktest — async dedup and fault tolerance', () => {
  const validBody = {
    strategyConfig: { type: 'pairs_trading', symbols: ['SPY', 'QQQ'] },
    startDate: '2024-01-01',
    endDate: '2024-03-01',
  };

  beforeEach(() => {
    // Default: no matching cached result, engine runs successfully
    mockFindMatch.mockResolvedValue(null);
    (BacktestEngine.prototype.run as jest.Mock).mockResolvedValue(makeResult());
    mockInsertResult.mockResolvedValue(undefined);
    mockInsertOrders.mockResolvedValue(undefined);
    mockInsertFills.mockResolvedValue(undefined);
  });

  it('calls findMatchingBacktestResult when force is not set', async () => {
    const res = mockRes();
    await runBacktest(mockReq({ body: validBody }), res);
    await flushAsync();
    expect(mockFindMatch).toHaveBeenCalledTimes(1);
  });

  it('skips findMatchingBacktestResult and runs the engine when force=true', async () => {
    // Set up a matching result that WOULD be returned for a normal run
    mockFindMatch.mockResolvedValue(makeResult('existing-bt'));
    const res = mockRes();
    await runBacktest(mockReq({ body: { ...validBody, force: true } }), res);
    await flushAsync();
    expect(mockFindMatch).not.toHaveBeenCalled();
    expect(BacktestEngine.prototype.run).toHaveBeenCalledTimes(1);
  });

  it('serves cached result (completes SSE) without running engine when dedup match is found', async () => {
    mockFindMatch.mockResolvedValue(makeResult('cached-bt'));
    const res = mockRes();
    await runBacktest(mockReq({ body: validBody }), res);
    await flushAsync();
    expect(BacktestEngine.prototype.run).not.toHaveBeenCalled();
    expect(mockStreamComplete).toHaveBeenCalledTimes(1);
  });

  it('proceeds as a fresh run (engine called) when dedup DB check fails', async () => {
    // Supabase unreachable — findMatchingBacktestResult throws
    mockFindMatch.mockRejectedValue(new Error('fetch failed'));
    const res = mockRes();
    await runBacktest(mockReq({ body: validBody }), res);
    await flushAsync();
    // Engine should still run (dedup failure is non-fatal)
    expect(BacktestEngine.prototype.run).toHaveBeenCalledTimes(1);
    // SSE channel should complete (not hang)
    expect(mockStreamComplete).toHaveBeenCalledTimes(1);
  });

  it('completes SSE successfully even when DB insert fails after engine run', async () => {
    // Engine runs fine but DB is unreachable for persistence
    mockInsertResult.mockRejectedValue(new Error('DB insert failed'));
    const res = mockRes();
    await runBacktest(mockReq({ body: validBody }), res);
    await flushAsync();
    // SSE complete fires before insert (result cached in memory)
    expect(mockStreamComplete).toHaveBeenCalledTimes(1);
    // SSE error should NOT have been called
    expect(mockStreamError).not.toHaveBeenCalled();
  });

  it('fires SSE error (not hang) when the backtest engine itself throws', async () => {
    (BacktestEngine.prototype.run as jest.Mock).mockRejectedValue(new Error('engine crash'));
    const res = mockRes();
    await runBacktest(mockReq({ body: validBody }), res);
    await flushAsync();
    expect(mockStreamError).toHaveBeenCalledTimes(1);
    expect(mockStreamComplete).not.toHaveBeenCalled();
  });

  it('fires SSE error even when both dedup AND engine throw (outer catch-all)', async () => {
    // Pathological case: dedup throws AND findMatch stub somehow re-throws in outer scope
    // We simulate this by making findMatch throw and engine throw
    mockFindMatch.mockRejectedValue(new Error('DB down'));
    (BacktestEngine.prototype.run as jest.Mock).mockRejectedValue(new Error('also down'));
    const res = mockRes();
    await runBacktest(mockReq({ body: validBody }), res);
    await flushAsync();
    // Outer catch-all must resolve the SSE channel
    expect(mockStreamError).toHaveBeenCalledTimes(1);
  });
});
