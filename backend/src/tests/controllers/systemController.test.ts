jest.mock('../../adapters/supabase/client');
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
import { getSupabaseClient } from '../../adapters/supabase/client';
import { healthCheck, getSystemStatus } from '../../app/controllers/systemController';

function mockRes() {
  const res = { json: jest.fn(), status: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response & { json: jest.Mock; status: jest.Mock };
}

function mockReq(): Request {
  return {} as Request;
}

function mockSupabaseOk() {
  (getSupabaseClient as jest.Mock).mockReturnValue({
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ error: null }),
    }),
  });
}

function mockSupabaseFail(message = 'connection refused') {
  (getSupabaseClient as jest.Mock).mockReturnValue({
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ error: { message, code: 'PGRST001' } }),
    }),
  });
}

function mockAlpacaOk() {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'ACTIVE' }),
  });
}

function mockAlpacaFail(status: number, body = {}) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

describe('healthCheck', () => {
  it('returns status ok with a ts timestamp', () => {
    const res = mockRes();
    healthCheck(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', ts: expect.any(String) }),
    );
  });
});

describe('getSystemStatus: overall health aggregation', () => {
  it('returns healthy when both services are up', async () => {
    mockSupabaseOk();
    mockAlpacaOk();
    const res = mockRes();
    await getSystemStatus(mockReq(), res);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.status).toBe('healthy');
    expect(body.services.supabase.health).toBe(true);
    expect(body.services.alpaca.health).toBe(true);
  });

  it('returns degraded when one service fails', async () => {
    mockSupabaseFail();
    mockAlpacaOk();
    const res = mockRes();
    await getSystemStatus(mockReq(), res);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.status).toBe('degraded');
  });

  it('returns unhealthy when both services fail', async () => {
    mockSupabaseFail();
    mockAlpacaFail(401);
    const res = mockRes();
    await getSystemStatus(mockReq(), res);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.status).toBe('unhealthy');
  });

  it('response includes the execution mode and a ts field', async () => {
    mockSupabaseOk();
    mockAlpacaOk();
    const res = mockRes();
    await getSystemStatus(mockReq(), res);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.mode).toBe('paper');
    expect(typeof body.ts).toBe('string');
  });
});

describe('getSystemStatus: Alpaca error codes', () => {
  it('maps 401 to an invalid-credentials message', async () => {
    mockSupabaseOk();
    mockAlpacaFail(401);
    const res = mockRes();
    await getSystemStatus(mockReq(), res);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.services.alpaca.health).toBe(false);
    expect(body.services.alpaca.error).toContain('401');
  });

  it('maps 403 to a forbidden message', async () => {
    mockSupabaseOk();
    mockAlpacaFail(403);
    const res = mockRes();
    await getSystemStatus(mockReq(), res);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.services.alpaca.error).toContain('403');
  });

  it('marks alpaca unhealthy when account status is not ACTIVE', async () => {
    mockSupabaseOk();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ACCOUNT_CLOSED' }),
    });
    const res = mockRes();
    await getSystemStatus(mockReq(), res);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.services.alpaca.health).toBe(false);
    expect(body.services.alpaca.accountStatus).toBe('ACCOUNT_CLOSED');
  });

  it('handles Alpaca network error gracefully', async () => {
    mockSupabaseOk();
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const res = mockRes();
    await getSystemStatus(mockReq(), res);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.services.alpaca.health).toBe(false);
  });
});

describe('getSystemStatus: Supabase error handling', () => {
  it('marks supabase unhealthy on error response', async () => {
    mockSupabaseFail('apikey invalid');
    mockAlpacaOk();
    const res = mockRes();
    await getSystemStatus(mockReq(), res);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.services.supabase.health).toBe(false);
  });

  it('handles Supabase network error gracefully', async () => {
    (getSupabaseClient as jest.Mock).mockImplementation(() => {
      throw new Error('network error');
    });
    mockAlpacaOk();
    const res = mockRes();
    await getSystemStatus(mockReq(), res);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.services.supabase.health).toBe(false);
  });
});
