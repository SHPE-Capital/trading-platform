jest.mock('../../adapters/supabase/repositories');
jest.mock('../../adapters/supabase/reviewRepositories');
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
    sandboxMaxCapitalPct: 0.05,
    sandboxMaxActiveRunsPerMember: 2,
    sandboxRunTtlHours: 24,
    runtimeOrigin: 'test',
    buildSha: 'test-sha',
    buildDirty: false,
    enableLiveTrading: false,
    enableWebSocketPush: true,
    databaseUrl: '',
  },
}));

import type { Request, Response } from 'express';
import * as repos from '../../adapters/supabase/repositories';
import * as review from '../../adapters/supabase/reviewRepositories';
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
const mockGetStrategy = repos.getStrategyById as jest.Mock;
const mockGetVersion = review.getStrategyVersionById as jest.Mock;
const mockCountRunning = repos.countRunningRunsForOwner as jest.Mock;
const TEST_USER = {
  id: 'user-1', email: 'member@example.com', role: 'member', displayName: 'Member', membershipStatus: 'active',
} as const;

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
    user: TEST_USER,
    ...overrides,
  } as unknown as Request;
}

/** The trading runtime's lease-holding run registry (Part 05). */
function makeLiveRuns() {
  return {
    owner: 'paper:host:1:abc',
    prepare: jest.fn(async () => {}),
    activate: jest.fn(),
    deactivate: jest.fn(async () => {}),
    leaseFields: jest.fn(() => ({ leaseOwner: 'paper:host:1:abc', leaseExpiresAt: 1 })),
  };
}

const pairsConfig = { name: 'Test Pairs', symbols: ['SPY', 'QQQ'], leg1Symbol: 'SPY', leg2Symbol: 'QQQ' };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetStrategy.mockResolvedValue({
    id: 'strat-1', strategy_type: 'pairs_trading', name: 'Test Pairs',
    config: pairsConfig, owner_id: TEST_USER.id,
  });
  mockGetVersion.mockResolvedValue({ id: 'ver-1', strategyId: 'strat-1', config: pairsConfig });
  mockCountRunning.mockResolvedValue(0);
  mockGetById.mockResolvedValue({ id: 'run-1', ownerId: TEST_USER.id });
});

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
      ctxReq({}, { body: { strategyId: 'strat-1', versionId: 'ver-1' } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(503);
  });
});

describe('startStrategyRun: with orchestrator', () => {
  it('returns 400 when strategy type is unknown', async () => {
    mockGetStrategy.mockResolvedValue({
      id: 'strat-1', strategy_type: 'no_such_strategy', name: 'x', config: {}, owner_id: TEST_USER.id,
    });
    const orchestrator = { registerStrategy: jest.fn() };
    const res = mockRes();
    await startStrategyRun(
      ctxReq({ orchestrator, liveRuns: makeLiveRuns(), executionMode: 'paper' }, { body: { strategyId: 'strat-1', versionId: 'ver-1' } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 409 when a strategy with the same config ID is already running', async () => {
    const orchestrator = { hasStrategyWithConfigId: jest.fn().mockReturnValue(true) };
    const liveRuns = makeLiveRuns();
    const res = mockRes();
    await startStrategyRun(
      ctxReq(
        { orchestrator, liveRuns, executionMode: 'paper' },
        { body: { strategyId: 'strat-1', versionId: 'ver-1' } },
      ),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(liveRuns.activate).not.toHaveBeenCalled();
  });

  it('rejects a version that does not belong to the selected strategy', async () => {
    mockGetVersion.mockResolvedValue({ id: 'ver-1', strategyId: 'strat-other', config: pairsConfig });
    const liveRuns = makeLiveRuns();
    const res = mockRes();

    await startStrategyRun(
      ctxReq(
        { orchestrator: { hasStrategyWithConfigId: jest.fn() }, liveRuns, executionMode: 'paper' },
        { body: { strategyId: 'strat-1', versionId: 'ver-1' } },
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(liveRuns.activate).not.toHaveBeenCalled();
  });

  it('enforces the per-member paper sandbox concurrency limit', async () => {
    mockCountRunning.mockResolvedValue(2);
    const liveRuns = makeLiveRuns();
    const res = mockRes();

    await startStrategyRun(
      ctxReq(
        { orchestrator: { hasStrategyWithConfigId: jest.fn().mockReturnValue(false) }, liveRuns, executionMode: 'paper' },
        { body: { strategyId: 'strat-1', versionId: 'ver-1' } },
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(429);
    expect(liveRuns.activate).not.toHaveBeenCalled();
  });

  it('returns 201 with run record for a valid pairs_trading start', async () => {
    const orchestrator = { hasStrategyWithConfigId: jest.fn().mockReturnValue(false) };
    const liveRuns = makeLiveRuns();
    mockInsertRun.mockResolvedValue(undefined);
    const res = mockRes();
    await startStrategyRun(
      ctxReq({ orchestrator, liveRuns, executionMode: 'paper' }, { body: { strategyId: 'strat-1', versionId: 'ver-1' } }),
      res,
    );
    expect(liveRuns.activate).toHaveBeenCalled();
    expect(mockInsertRun).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ strategyType: 'pairs_trading', status: 'running' }),
    );
  });

  it('warms up, persists a row already leased to this runner, then starts trading', async () => {
    const orchestrator = { hasStrategyWithConfigId: jest.fn().mockReturnValue(false) };
    const liveRuns = makeLiveRuns();
    mockInsertRun.mockResolvedValue(undefined);
    await startStrategyRun(
      ctxReq({ orchestrator, liveRuns, executionMode: 'paper' }, { body: { strategyId: 'strat-1', versionId: 'ver-1' } }),
      mockRes(),
    );

    const run = mockInsertRun.mock.calls[0][0];
    expect(run.leaseOwner).toBe(liveRuns.owner);
    expect(run.strategyId).toBe('strat-1');
    expect(liveRuns.prepare.mock.invocationCallOrder[0]).toBeLessThan(mockInsertRun.mock.invocationCallOrder[0]);
    expect(mockInsertRun.mock.invocationCallOrder[0]).toBeLessThan(liveRuns.activate.mock.invocationCallOrder[0]);
  });

  it('rejects an unsaved config instead of trusting caller-supplied trading parameters', async () => {
    const orchestrator = { hasStrategyWithConfigId: jest.fn().mockReturnValue(false) };
    const liveRuns = makeLiveRuns();
    mockInsertRun.mockResolvedValue(undefined);
    const res = mockRes();
    await startStrategyRun(
      ctxReq({ orchestrator, liveRuns, executionMode: 'paper' }, { body: { strategyType: 'pairs_trading', config: pairsConfig } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockInsertRun).not.toHaveBeenCalled();
  });

  it('never starts trading when the row cannot be persisted', async () => {
    const orchestrator = { hasStrategyWithConfigId: jest.fn().mockReturnValue(false) };
    const liveRuns = makeLiveRuns();
    mockInsertRun.mockRejectedValue(new Error('db down'));
    const res = mockRes();
    await startStrategyRun(
      ctxReq({ orchestrator, liveRuns, executionMode: 'paper' }, { body: { strategyId: 'strat-1', versionId: 'ver-1' } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(liveRuns.activate).not.toHaveBeenCalled();
  });

  it('returns 409 when the strategy already has a live run on any runner', async () => {
    const orchestrator = { hasStrategyWithConfigId: jest.fn().mockReturnValue(false) };
    const liveRuns = makeLiveRuns();
    mockInsertRun.mockRejectedValue(new repos.StrategyAlreadyLiveError('strat-1'));
    const res = mockRes();
    await startStrategyRun(
      ctxReq({ orchestrator, liveRuns, executionMode: 'paper' }, { body: { strategyId: 'strat-1', versionId: 'ver-1' } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(liveRuns.activate).not.toHaveBeenCalled();
  });
});

describe('stopStrategyRun', () => {
  it('returns 503 when orchestrator is not in context', async () => {
    const res = mockRes();
    await stopStrategyRun(mockReq({ params: { id: 'run-1' } as never }), res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('still marks the run stopped when this runner is not trading it (restart, or leased elsewhere)', async () => {
    const orchestrator = { hasStrategy: jest.fn().mockReturnValue(false) };
    const liveRuns = makeLiveRuns();
    mockUpdateRun.mockResolvedValue(undefined);
    const res = mockRes();
    await stopStrategyRun(
      ctxReq({ orchestrator, liveRuns }, { params: { id: 'run-1' } } as Partial<Request>),
      res,
    );
    // The DB row is what tells whichever runner holds it to stop.
    expect(mockUpdateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'stopped' }));
    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('run-1') }));
  });

  it('marks the run stopped before giving up the lease, and returns 200', async () => {
    const orchestrator = { hasStrategy: jest.fn().mockReturnValue(true) };
    const liveRuns = makeLiveRuns();
    mockUpdateRun.mockResolvedValue(undefined);
    const res = mockRes();
    await stopStrategyRun(
      ctxReq({ orchestrator, liveRuns }, { params: { id: 'run-1' } } as Partial<Request>),
      res,
    );
    expect(liveRuns.deactivate).toHaveBeenCalledWith('run-1');
    expect(mockUpdateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'stopped' }));
    // Releasing a still-"running" row would let another runner adopt it straight back.
    expect(mockUpdateRun.mock.invocationCallOrder[0]).toBeLessThan(liveRuns.deactivate.mock.invocationCallOrder[0]);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('run-1') }),
    );
  });
});
