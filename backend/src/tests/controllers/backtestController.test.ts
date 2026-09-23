jest.mock('../../adapters/supabase/repositories', () => ({
  ...jest.requireActual('../../adapters/supabase/repositories'),
  getAllBacktestResults: jest.fn(),
  getBacktestResultById: jest.fn(),
  backtestResultExists: jest.fn(),
  findMatchingBacktestResult: jest.fn(),
  insertBacktestResult: jest.fn(),
  insertBacktestOrders: jest.fn(),
  insertBacktestFills: jest.fn(),
}));
jest.mock('../../adapters/supabase/backtestJobRepository');
jest.mock('../../core/backtest/backtestEngine');
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
import * as jobs from '../../adapters/supabase/backtestJobRepository';
import { BacktestEngine } from '../../core/backtest/backtestEngine';
import {
  listBacktests,
  getBacktest,
  runBacktest,
  saveBacktest,
} from '../../app/controllers/backtestController';
import type { BacktestResult, BacktestConfig } from '../../types/backtest';
import type { BacktestJob } from '../../types/backtestJob';
import type { AuthenticatedUser } from '../../types/review';

const mockGetAll = repos.getAllBacktestResults as jest.Mock;
const mockGetById = repos.getBacktestResultById as jest.Mock;
const mockExists = repos.backtestResultExists as jest.Mock;
const mockFindMatch = repos.findMatchingBacktestResult as jest.Mock;
const mockInsertResult = repos.insertBacktestResult as jest.Mock;
const mockInsertOrders = repos.insertBacktestOrders as jest.Mock;
const mockInsertFills = repos.insertBacktestFills as jest.Mock;
const mockEnqueue = jobs.enqueueBacktestJob as jest.Mock;
const mockFindReusable = jobs.findReusableJob as jest.Mock;
const mockGetJob = jobs.getBacktestJob as jest.Mock;
const mockReadSummary = jobs.readJobSummary as jest.Mock;
const mockReadFull = jobs.readJobResultFull as jest.Mock;
const mockDeleteArtifacts = jobs.deleteJobArtifacts as jest.Mock;

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
    orders: [{ id: 'o1' }],
    fills: [{ id: 'f1' }],
    equity_curve: [],
    metrics: { totalReturnPct: 0, maxDrawdown: 0, winRate: 0, totalTrades: 0 },
    started_at: Date.now(),
    completed_at: Date.now(),
  } as unknown as BacktestResult;
}

function makeJob(overrides: Partial<BacktestJob> = {}): BacktestJob {
  return {
    id: 'job-1',
    configKey: 'k',
    config: makeResult().config,
    status: 'queued',
    leaseOwner: null,
    leaseExpiresAt: null,
    resultId: null,
    errorMessage: null,
    attempts: 0,
    requestedBy: null,
    progress: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    resultExpiresAt: null,
    ...overrides,
  };
}

const TEST_USER: AuthenticatedUser = {
  id: 'user-42',
  email: 'a@example.com',
  role: 'member',
  displayName: 'A. Member',
};

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

const validBody = {
  strategyConfig: { type: 'pairs_trading', symbols: ['SPY', 'QQQ'] },
  startDate: '2024-01-01',
  endDate: '2024-03-01',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFindMatch.mockResolvedValue(null);
  mockFindReusable.mockResolvedValue(null);
  mockEnqueue.mockImplementation(async ({ id }: { id: string }) => ({ jobId: id, status: 'queued', deduped: false }));
});

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
  it('serves a saved result first', async () => {
    const result = { id: 'bt-1' } as BacktestResult;
    mockGetById.mockResolvedValue(result);
    const res = mockRes();
    await getBacktest(mockReq({ params: { id: 'bt-1' } as never }), res);
    expect(res.json).toHaveBeenCalledWith(result);
    expect(mockReadSummary).not.toHaveBeenCalled();
  });

  it('falls back to a staged, unsaved result', async () => {
    mockGetById.mockResolvedValue(null);
    const staged = { id: 'job-1', result_expires_at: 123 } as unknown as BacktestResult;
    mockReadSummary.mockResolvedValue(staged);
    const res = mockRes();
    await getBacktest(mockReq({ params: { id: 'job-1' } as never }), res);
    expect(res.json).toHaveBeenCalledWith(staged);
  });

  it('returns 202 while the job is still running', async () => {
    mockGetById.mockResolvedValue(null);
    mockReadSummary.mockResolvedValue(null);
    mockGetJob.mockResolvedValue(makeJob({ status: 'running' }));
    const res = mockRes();
    await getBacktest(mockReq({ params: { id: 'job-1' } as never }), res);
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('returns 404 with a re-run hint when an unsaved result has expired', async () => {
    mockGetById.mockResolvedValue(null);
    mockReadSummary.mockResolvedValue(null);
    mockGetJob.mockResolvedValue(makeJob({ status: 'succeeded' }));
    const res = mockRes();
    await getBacktest(mockReq({ params: { id: 'job-1' } as never }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].detail).toMatch(/re-run/i);
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
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('returns 400 for a strategy type no worker can build', async () => {
    const res = mockRes();
    await runBacktest(mockReq({ body: { ...validBody, strategyConfig: { type: 'nope', symbols: ['X'] } } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('enqueues a job and responds 202 — the engine never runs in this process', async () => {
    const res = mockRes();
    await runBacktest(mockReq({ body: validBody }), res);

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json.mock.calls[0][0]).toMatchObject({ status: 'queued', deduped: false });
    expect(BacktestEngine.prototype.run).not.toHaveBeenCalled();
  });

  it('attributes the job to the signed-in member for the per-member cap', async () => {
    await runBacktest(mockReq({ body: validBody, user: TEST_USER } as never), mockRes());
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ requestedBy: TEST_USER.id }));
  });

  it('returns the in-flight job when an identical run is already queued elsewhere', async () => {
    mockEnqueue.mockResolvedValue({ jobId: 'existing-job', status: 'running', deduped: true });
    const res = mockRes();
    await runBacktest(mockReq({ body: validBody }), res);
    expect(res.json.mock.calls[0][0]).toMatchObject({ backtestId: 'existing-job', deduped: true });
  });

  it('reuses a saved identical result without enqueueing', async () => {
    mockFindMatch.mockResolvedValue(makeResult('saved-bt'));
    const res = mockRes();
    await runBacktest(mockReq({ body: validBody }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ backtestId: 'saved-bt', reused: true }));
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('reuses a recent unsaved identical result without enqueueing', async () => {
    mockFindReusable.mockResolvedValue(makeJob({ id: 'recent-job', status: 'succeeded' }));
    const res = mockRes();
    await runBacktest(mockReq({ body: validBody }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ backtestId: 'recent-job', reused: true }));
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('force=true skips reuse and always enqueues', async () => {
    mockFindMatch.mockResolvedValue(makeResult('saved-bt'));
    await runBacktest(mockReq({ body: { ...validBody, force: true } }), mockRes());
    expect(mockFindMatch).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0][0].config).not.toHaveProperty('force');
  });

  it('still enqueues when the saved-result lookup fails', async () => {
    mockFindMatch.mockRejectedValue(new Error('fetch failed'));
    const res = mockRes();
    await runBacktest(mockReq({ body: validBody }), res);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('returns 500 when the job cannot be enqueued', async () => {
    mockEnqueue.mockRejectedValue(new Error('DB down'));
    const res = mockRes();
    await runBacktest(mockReq({ body: validBody }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('saveBacktest', () => {
  beforeEach(() => {
    mockExists.mockResolvedValue(false);
    mockReadFull.mockResolvedValue(makeResult('job-save'));
    mockInsertResult.mockResolvedValue(undefined);
    mockInsertOrders.mockResolvedValue(undefined);
    mockInsertFills.mockResolvedValue(undefined);
    mockDeleteArtifacts.mockResolvedValue(undefined);
  });

  it('persists result, orders, then fills, frees the staged copy, and returns 201', async () => {
    const res = mockRes();
    await saveBacktest(mockReq({ params: { id: 'job-save' }, user: TEST_USER } as never), res);

    expect(mockInsertResult).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-save' }), TEST_USER.id);
    expect(mockInsertOrders).toHaveBeenCalledWith('job-save', [{ id: 'o1' }]);
    expect(mockInsertFills).toHaveBeenCalledWith('job-save', [{ id: 'f1' }]);
    // Orders before fills: backtest_fills.order_id references backtest_orders.id.
    expect(mockInsertOrders.mock.invocationCallOrder[0]).toBeLessThan(mockInsertFills.mock.invocationCallOrder[0]);
    expect(mockDeleteArtifacts).toHaveBeenCalledWith('job-save');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 'job-save', alreadySaved: false });
  });

  it('short-circuits with alreadySaved when a row already exists', async () => {
    mockExists.mockResolvedValue(true);
    const res = mockRes();
    await saveBacktest(mockReq({ params: { id: 'bt-already' }, user: TEST_USER } as never), res);
    expect(mockInsertResult).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ id: 'bt-already', alreadySaved: true });
  });

  it('returns 404 with a re-run hint when the save window has closed', async () => {
    mockReadFull.mockResolvedValue(null);
    const res = mockRes();
    await saveBacktest(mockReq({ params: { id: 'gone' }, user: TEST_USER } as never), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].detail).toMatch(/re-run/i);
    expect(mockInsertResult).not.toHaveBeenCalled();
  });

  it('keeps the staged copy when persisting fails, so a retry needs no re-run', async () => {
    mockInsertResult.mockRejectedValueOnce(new Error('DB unreachable'));
    const failRes = mockRes();
    await saveBacktest(mockReq({ params: { id: 'job-save' }, user: TEST_USER } as never), failRes);
    expect(failRes.status).toHaveBeenCalledWith(500);
    expect(mockDeleteArtifacts).not.toHaveBeenCalled();

    const retryRes = mockRes();
    await saveBacktest(mockReq({ params: { id: 'job-save' }, user: TEST_USER } as never), retryRes);
    expect(retryRes.status).toHaveBeenCalledWith(201);
  });

  it('still reports success when freeing the staged copy fails — the sweep drops it later', async () => {
    mockDeleteArtifacts.mockRejectedValue(new Error('flaky'));
    const res = mockRes();
    await saveBacktest(mockReq({ params: { id: 'job-save' }, user: TEST_USER } as never), res);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
