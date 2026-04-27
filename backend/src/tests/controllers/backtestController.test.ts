jest.mock('../../adapters/supabase/repositories');
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
import {
  listBacktests,
  getBacktest,
  runBacktest,
} from '../../app/controllers/backtestController';
import type { BacktestResult } from '../../types/backtest';

const mockGetAll = repos.getAllBacktestResults as jest.Mock;
const mockGetById = repos.getBacktestResultById as jest.Mock;

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

describe('runBacktest', () => {
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
});
