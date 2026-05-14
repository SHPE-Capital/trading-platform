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

const mockInsertRun = repos.insertStrategyRun as jest.Mock;
const mockUpdateRun = repos.updateStrategyRun as jest.Mock;
const mockGetAll = repos.getAllStrategyRuns as jest.Mock;
const mockGetById = repos.getStrategyRunById as jest.Mock;

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
    expect(res.json).toHaveBeenCalledWith([{ id: 'run-1', isLive: false }]);
  });

  it('returns 500 on error', async () => {
    mockGetAll.mockRejectedValue(new Error('fail'));
    const res = mockRes();
    await listStrategyRuns(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('getStrategyRun', () => {
  it('returns 404 when run not found', async () => {
    mockGetById.mockResolvedValue(null);
    const res = mockRes();
    await getStrategyRun(mockReq({ params: { id: 'missing' } as never }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns run with isLive=false when orchestrator does not have it', async () => {
    const run = { id: 'run-1', status: 'running' } as StrategyRun;
    mockGetById.mockResolvedValue(run);
    const orchestrator = { hasStrategy: jest.fn().mockReturnValue(false) };
    const res = mockRes();
    await getStrategyRun(ctxReq({ orchestrator }, { params: { id: 'run-1' } as never }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-1', isLive: false }));
  });

  it('returns run with isLive=true when orchestrator has it', async () => {
    const run = { id: 'run-1', status: 'running' } as StrategyRun;
    mockGetById.mockResolvedValue(run);
    const orchestrator = { hasStrategy: jest.fn().mockReturnValue(true) };
    const res = mockRes();
    await getStrategyRun(ctxReq({ orchestrator }, { params: { id: 'run-1' } as never }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-1', isLive: true }));
  });

  it('returns isLive=false when no orchestrator in context', async () => {
    const run = { id: 'run-1', status: 'stopped' } as StrategyRun;
    mockGetById.mockResolvedValue(run);
    const res = mockRes();
    await getStrategyRun(mockReq({ params: { id: 'run-1' } as never }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-1', isLive: false }));
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

describe('startStrategyRun: with orchestrator', () => {
  it('returns 400 when strategy type is unknown', async () => {
    const orchestrator = { registerStrategy: jest.fn() };
    const res = mockRes();
    await startStrategyRun(
      ctxReq({ orchestrator }, { body: { strategyType: 'no_such_strategy', config: { name: 'x' } } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 409 when a strategy with the same config ID is already running', async () => {
    const orchestrator = {
      registerStrategy: jest.fn(),
      hasStrategyWithConfigId: jest.fn().mockReturnValue(true),
    };
    const res = mockRes();
    await startStrategyRun(
      ctxReq(
        { orchestrator },
        { body: { strategyType: 'pairs_trading', config: { id: 'config-uuid-1', name: 'Test Pairs', symbols: ['SPY', 'QQQ'], leg1Symbol: 'SPY', leg2Symbol: 'QQQ' } } },
      ),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(orchestrator.registerStrategy).not.toHaveBeenCalled();
  });

  it('returns 201 with run record for a valid pairs_trading start', async () => {
    const orchestrator = { registerStrategy: jest.fn() };
    mockInsertRun.mockResolvedValue(undefined);
    const res = mockRes();
    await startStrategyRun(
      ctxReq(
        { orchestrator },
        {
          body: {
            strategyType: 'pairs_trading',
            config: { name: 'Test Pairs', symbols: ['SPY', 'QQQ'], leg1Symbol: 'SPY', leg2Symbol: 'QQQ' },
          },
        },
      ),
      res,
    );
    expect(orchestrator.registerStrategy).toHaveBeenCalled();
    expect(mockInsertRun).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ strategyType: 'pairs_trading', status: 'running' }),
    );
  });
});

describe('stopStrategyRun', () => {
  it('returns 503 when orchestrator is not in context', async () => {
    const res = mockRes();
    await stopStrategyRun(mockReq({ params: { id: 'run-1' } as never }), res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('cleans up stale DB state when strategy is not in orchestrator (server restart)', async () => {
    const orchestrator = {
      deregisterStrategy: jest.fn(),
      hasStrategy: jest.fn().mockReturnValue(false),
    };
    mockUpdateRun.mockResolvedValue(undefined);
    const res = mockRes();
    await stopStrategyRun(
      ctxReq({ orchestrator }, { params: { id: 'run-1' } } as Partial<Request>),
      res,
    );
    // Must NOT call deregister (strategy not in memory)
    expect(orchestrator.deregisterStrategy).not.toHaveBeenCalled();
    // Must still update DB to stopped so the UI cleans up
    expect(mockUpdateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'stopped' }));
    // Returns 200 success, not 404
    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('run-1') }));
  });

  it('calls orchestrator.deregisterStrategy and returns 200', async () => {
    const orchestrator = {
      deregisterStrategy: jest.fn(),
      hasStrategy: jest.fn().mockReturnValue(true),
    };
    mockUpdateRun.mockResolvedValue(undefined);
    const res = mockRes();
    await stopStrategyRun(
      ctxReq({ orchestrator }, { params: { id: 'run-1' } } as Partial<Request>),
      res,
    );
    expect(orchestrator.deregisterStrategy).toHaveBeenCalledWith('run-1');
    expect(mockUpdateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'stopped' }));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('run-1') }),
    );
  });
});
