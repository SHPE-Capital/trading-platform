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
import {
  listReplaySessions,
  loadReplaySession,
  controlReplay,
  getReplayStatus,
} from '../../app/controllers/replayController';

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

function ctxReq(ctx: Record<string, unknown>, body: Record<string, unknown> = {}): Request {
  return {
    body,
    params: {},
    query: {},
    app: { locals: { ctx } },
  } as unknown as Request;
}

describe('listReplaySessions', () => {
  it('returns an empty array (stub)', async () => {
    const res = mockRes();
    await listReplaySessions(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith([]);
  });
});

describe('loadReplaySession', () => {
  it('returns 400 when sessionId is missing', async () => {
    const res = mockRes();
    await loadReplaySession(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 503 when replayEngine is not in context', async () => {
    const res = mockRes();
    await loadReplaySession(ctxReq({}, { sessionId: 'sess-1' }), res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 501 when replayEngine is present (not yet implemented)', async () => {
    const replayEngine = { control: jest.fn(), getSession: jest.fn() };
    const res = mockRes();
    await loadReplaySession(ctxReq({ replayEngine }, { sessionId: 'sess-1' }), res);
    expect(res.status).toHaveBeenCalledWith(501);
  });
});

describe('controlReplay', () => {
  it('returns 400 when command.action is missing', async () => {
    const res = mockRes();
    await controlReplay(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 503 when replayEngine is not in context', async () => {
    const res = mockRes();
    await controlReplay(ctxReq({}, { action: 'play' }), res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('calls engine.control and returns 200 when engine present', async () => {
    const replayEngine = { control: jest.fn(), getSession: jest.fn() };
    const command = { action: 'play' };
    const res = mockRes();
    await controlReplay(ctxReq({ replayEngine }, command), res);
    expect(replayEngine.control).toHaveBeenCalledWith(command);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('play') }),
    );
  });
});

describe('getReplayStatus', () => {
  it('returns null when no replayEngine in context', async () => {
    const res = mockRes();
    await getReplayStatus(ctxReq({}), res);
    expect(res.json).toHaveBeenCalledWith(null);
  });

  it('returns engine.getSession() when engine present', async () => {
    const session = { id: 'sess-1', status: 'idle' };
    const replayEngine = { control: jest.fn(), getSession: jest.fn().mockReturnValue(session) };
    const res = mockRes();
    await getReplayStatus(ctxReq({ replayEngine }), res);
    expect(res.json).toHaveBeenCalledWith(session);
  });
});
