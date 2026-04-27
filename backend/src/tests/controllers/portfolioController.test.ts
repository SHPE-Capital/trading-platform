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
  getPortfolioSnapshot,
  getEquityCurve,
  getOrders,
} from '../../app/controllers/portfolioController';
import type { PortfolioSnapshot } from '../../types/portfolio';
import type { Order } from '../../types/orders';

const mockGetSnapshot = repos.getLatestPortfolioSnapshot as jest.Mock;
const mockGetCurve = repos.getPortfolioEquityCurve as jest.Mock;
const mockGetOrders = repos.getOrdersByStrategyRun as jest.Mock;

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

beforeEach(() => jest.clearAllMocks());

describe('getPortfolioSnapshot', () => {
  it('returns the snapshot as JSON', async () => {
    const snap = { id: 'snap-1', equity: 100_000 } as PortfolioSnapshot;
    mockGetSnapshot.mockResolvedValue(snap);
    const res = mockRes();
    await getPortfolioSnapshot(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(snap);
  });

  it('returns 404 when no snapshot exists', async () => {
    mockGetSnapshot.mockResolvedValue(null);
    const res = mockRes();
    await getPortfolioSnapshot(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 500 on repository error', async () => {
    mockGetSnapshot.mockRejectedValue(new Error('fail'));
    const res = mockRes();
    await getPortfolioSnapshot(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('getEquityCurve', () => {
  it('calls getPortfolioEquityCurve and returns result', async () => {
    const curve = [{ id: 'snap-1' } as PortfolioSnapshot];
    mockGetCurve.mockResolvedValue(curve);
    const res = mockRes();
    await getEquityCurve(mockReq({ query: { limit: '100' } as never }), res);
    expect(res.json).toHaveBeenCalledWith(curve);
  });

  it('passes parsed limit query parameter', async () => {
    mockGetCurve.mockResolvedValue([]);
    const res = mockRes();
    await getEquityCurve(mockReq({ query: { limit: '200' } as never }), res);
    expect(mockGetCurve).toHaveBeenCalledWith(200);
  });

  it('uses default limit of 500 when not provided', async () => {
    mockGetCurve.mockResolvedValue([]);
    const res = mockRes();
    await getEquityCurve(mockReq(), res);
    expect(mockGetCurve).toHaveBeenCalledWith(500);
  });
});

describe('getOrders', () => {
  it('returns 400 when strategyRunId is missing', async () => {
    const res = mockRes();
    await getOrders(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('calls getOrdersByStrategyRun with the provided ID', async () => {
    const orders = [{ id: 'o1' } as Order];
    mockGetOrders.mockResolvedValue(orders);
    const res = mockRes();
    await getOrders(mockReq({ query: { strategyRunId: 'run-1' } as never }), res);
    expect(mockGetOrders).toHaveBeenCalledWith('run-1');
    expect(res.json).toHaveBeenCalledWith(orders);
  });

  it('returns 500 on repository error', async () => {
    mockGetOrders.mockRejectedValue(new Error('fail'));
    const res = mockRes();
    await getOrders(mockReq({ query: { strategyRunId: 'run-1' } as never }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
