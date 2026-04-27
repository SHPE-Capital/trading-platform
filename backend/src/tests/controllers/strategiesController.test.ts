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
  listStrategyRuns,
  getStrategyRun,
  startStrategyRun,
  stopStrategyRun,
} from '../../app/controllers/strategiesController';
import type { StrategyRun } from '../../types/strategy';

const mockGetAll = repos.getAllStrategyRuns as jest.Mock;

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
  const res = { json: jest.fn(), status: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response & { json: jest.Mock; status: jest.Mock };
}

function ctxReq(
  ctx: Record<string, unknown>,
  overrides: Partial<Request> = {},
): Request {
  return {
    body: {},
    params: {},
    query: {},
    app: { locals: { ctx } },
    ...overrides,
  } as unknown as Request;
}

beforeEach(() => jest.clearAllMocks());

describe('listStrategyRuns', () => {
  it('calls getAllStrategyRuns and returns result', async () => {
    const runs = [{ id: 'run-1' } as StrategyRun];
    mockGetAll.mockResolvedValue(runs);
    const res = mockRes();
    await listStrategyRuns(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(runs);
  });

  it('returns 500 on error', async () => {
    mockGetAll.mockRejectedValue(new Error('fail'));
    const res = mockRes();
    await listStrategyRuns(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('getStrategyRun', () => {
  it('returns the matching run by id', async () => {
    const runs = [{ id: 'run-1' }, { id: 'run-2' }] as StrategyRun[];
    mockGetAll.mockResolvedValue(runs);
    const res = mockRes();
    await getStrategyRun(mockReq({ params: { id: 'run-2' } as never }), res);
    expect(res.json).toHaveBeenCalledWith(runs[1]);
  });

  it('returns 404 when run not found', async () => {
    mockGetAll.mockResolvedValue([]);
    const res = mockRes();
    await getStrategyRun(mockReq({ params: { id: 'missing' } as never }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('startStrategyRun', () => {
  it('returns 400 when strategyType or config is missing', async () => {
    const res = mockRes();
    await startStrategyRun(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 503 when orchestrator is not in context', async () => {
    const res = mockRes();
    await startStrategyRun(
      ctxReq({}, { body: { strategyType: 'pairs_trading', config: {} } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(503);
  });
});

describe('stopStrategyRun', () => {
  it('returns 503 when orchestrator is not in context', async () => {
    const res = mockRes();
    await stopStrategyRun(mockReq({ params: { id: 'run-1' } as never }), res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('calls orchestrator.deregisterStrategy and returns 200', async () => {
    const orchestrator = { deregisterStrategy: jest.fn() };
    const res = mockRes();
    await stopStrategyRun(
      ctxReq({ orchestrator }, { params: { id: 'run-1' } } as Partial<Request>),
      res,
    );
    expect(orchestrator.deregisterStrategy).toHaveBeenCalledWith('run-1');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('run-1') }),
    );
  });
});
