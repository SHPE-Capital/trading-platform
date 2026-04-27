jest.mock('../../config/env', () => ({
  env: {
    alpacaApiKey: 'test-key',
    alpacaApiSecret: 'test-secret',
    alpacaTradingMode: 'paper',
    alpacaPaperBaseUrl: 'https://paper-api.alpaca.markets',
    alpacaLiveBaseUrl: 'https://api.alpaca.markets',
    alpacaDataStreamUrl: 'wss://stream.data.alpaca.markets/v2',
    alpacaPaperStreamUrl: 'wss://paper-api.alpaca.markets/stream',
    alpacaLiveStreamUrl: 'wss://api.alpaca.markets/stream',
    supabaseUrl: 'https://test.supabase.co',
    supabaseAnonKey: 'test-anon',
    supabaseServiceRoleKey: 'test-service',
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
import {
  getTrackedSymbols,
  getSymbolSnapshot,
} from '../../app/controllers/marketDataController';

function mockRes() {
  const res = { json: jest.fn(), status: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response & { json: jest.Mock; status: jest.Mock };
}

function ctxReq(ctx: Record<string, unknown>, params: Record<string, string> = {}): Request {
  return {
    body: {},
    params,
    query: {},
    app: { locals: { ctx } },
  } as unknown as Request;
}

describe('getTrackedSymbols', () => {
  it('returns an empty array when symbolState is not in context', async () => {
    const res = mockRes();
    await getTrackedSymbols(ctxReq({}), res);
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('returns the result of symbolState.getSymbols()', async () => {
    const symbolState = { getSymbols: jest.fn().mockReturnValue(['SPY', 'AAPL']) };
    const res = mockRes();
    await getTrackedSymbols(ctxReq({ symbolState }), res);
    expect(res.json).toHaveBeenCalledWith(['SPY', 'AAPL']);
  });
});

describe('getSymbolSnapshot', () => {
  it('returns 404 when symbolState is not in context', async () => {
    const res = mockRes();
    await getSymbolSnapshot(ctxReq({}, { symbol: 'SPY' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 404 when the symbol is not tracked by symbolState', async () => {
    const symbolState = { get: jest.fn().mockReturnValue(null) };
    const res = mockRes();
    await getSymbolSnapshot(ctxReq({ symbolState }, { symbol: 'NVDA' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns the symbol state as JSON when found', async () => {
    const state = { symbol: 'SPY', latestMid: 500 };
    const symbolState = { get: jest.fn().mockReturnValue(state) };
    const res = mockRes();
    await getSymbolSnapshot(ctxReq({ symbolState }, { symbol: 'SPY' }), res);
    expect(res.json).toHaveBeenCalledWith(state);
  });
});
