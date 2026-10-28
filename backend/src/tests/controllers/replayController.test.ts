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

jest.mock('../../adapters/supabase/eventLogRepository', () => ({
  listEventLogs: jest.fn(),
  getEventLog: jest.fn(),
}));

import type { Request, Response } from 'express';
import {
  listReplaySessions,
  loadReplaySession,
  controlReplay,
  getReplayStatus,
  getReplayAttribution,
} from '../../app/controllers/replayController';
import { listEventLogs, getEventLog } from '../../adapters/supabase/eventLogRepository';

const LOG_ID = '6f1c2d4e-8a9b-4c3d-9e2f-1a2b3c4d5e6f';
const mockList = listEventLogs as jest.Mock;
const mockGet = getEventLog as jest.Mock;

function mockEngine(status: Record<string, unknown> | null = null) {
  return { control: jest.fn(), load: jest.fn(), getStatus: jest.fn().mockReturnValue(status) };
}

const loggedEvents = [
  { id: 'e1', type: 'QUOTE_RECEIVED', ts: 1_000, mode: 'paper', payload: { symbol: 'SPY' } },
  { id: 'e2', type: 'QUOTE_RECEIVED', ts: 2_000, mode: 'paper', payload: { symbol: 'QQQ' } },
  { id: 'e3', type: 'HEARTBEAT', ts: 3_000, mode: 'paper' },
];
const loggedRecord = { id: LOG_ID, name: 'paper session', source: 'paper', eventCount: 3, startDate: '', endDate: '', createdAt: 0 };

beforeEach(() => jest.clearAllMocks());

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
  it('returns the stored event logs', async () => {
    mockList.mockResolvedValue([loggedRecord]);
    const res = mockRes();
    await listReplaySessions(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith([loggedRecord]);
  });

  it('returns 500 when the repository fails', async () => {
    mockList.mockRejectedValue(new Error('down'));
    const res = mockRes();
    await listReplaySessions(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('loadReplaySession', () => {
  it('returns 400 when sessionId is missing', async () => {
    const res = mockRes();
    await loadReplaySession(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when sessionId is not a UUID', async () => {
    const res = mockRes();
    await loadReplaySession(ctxReq({ replayEngine: mockEngine() }, { sessionId: 'sess-1' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for an empty filter', async () => {
    const res = mockRes();
    await loadReplaySession(ctxReq({ replayEngine: mockEngine() }, { sessionId: LOG_ID, filter: { symbols: [] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 503 when replayEngine is not in context', async () => {
    const res = mockRes();
    await loadReplaySession(ctxReq({}, { sessionId: LOG_ID }), res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 404 when the event log does not exist', async () => {
    mockGet.mockResolvedValue(null);
    const res = mockRes();
    await loadReplaySession(ctxReq({ replayEngine: mockEngine() }, { sessionId: LOG_ID }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 422 when the filter leaves no events', async () => {
    mockGet.mockResolvedValue({ record: loggedRecord, events: loggedEvents });
    const replayEngine = mockEngine();
    const res = mockRes();
    await loadReplaySession(ctxReq({ replayEngine }, { sessionId: LOG_ID, filter: { startTs: 10_000 } }), res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(replayEngine.load).not.toHaveBeenCalled();
  });

  it('loads the filtered events paused at the first one and starts attribution', async () => {
    mockGet.mockResolvedValue({ record: loggedRecord, events: loggedEvents });
    const replayEngine = mockEngine({ id: 'loaded' });
    const attributionCollector = { start: jest.fn() };
    const res = mockRes();
    await loadReplaySession(
      ctxReq({ replayEngine, attributionCollector }, { sessionId: LOG_ID, filter: { symbols: ['SPY'] } }),
      res,
    );
    const session = replayEngine.load.mock.calls[0][0];
    expect(session).toMatchObject({ name: 'paper session', totalEvents: 2, cursor: 0, status: 'paused', simulatedNow: 1_000 });
    expect(session.events.map((e: { id: string }) => e.id)).toEqual(['e1', 'e3']);
    expect(attributionCollector.start).toHaveBeenCalledWith(session.id);
    expect(res.json).toHaveBeenCalledWith({ message: 'Session loaded', session: { id: 'loaded' } });
  });

  it('returns 500 when the repository fails', async () => {
    mockGet.mockRejectedValue(new Error('down'));
    const res = mockRes();
    await loadReplaySession(ctxReq({ replayEngine: mockEngine() }, { sessionId: LOG_ID }), res);
    expect(res.status).toHaveBeenCalledWith(500);
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
    const replayEngine = mockEngine({ id: 's', status: 'playing' });
    const command = { action: 'play' };
    const res = mockRes();
    await controlReplay(ctxReq({ replayEngine }, command), res);
    expect(replayEngine.control).toHaveBeenCalledWith(command);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('play'), session: { id: 's', status: 'playing' } }),
    );
  });
});

describe('getReplayStatus', () => {
  it('returns null when no replayEngine in context', async () => {
    const res = mockRes();
    await getReplayStatus(ctxReq({}), res);
    expect(res.json).toHaveBeenCalledWith(null);
  });

  it('returns engine.getStatus() when engine present', async () => {
    const session = { id: 'sess-1', status: 'idle' };
    const replayEngine = mockEngine(session);
    const res = mockRes();
    await getReplayStatus(ctxReq({ replayEngine }), res);
    expect(res.json).toHaveBeenCalledWith(session);
  });
});

describe('getReplayAttribution', () => {
  const report = { sessionId: 'sess-1', totalSignals: 0 };

  it('returns 503 without a collector', async () => {
    const res = mockRes();
    await getReplayAttribution(ctxReq({ replayEngine: mockEngine() }), res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 409 until the session completes', async () => {
    const attributionCollector = { activeSessionId: 'sess-1', getAttribution: jest.fn() };
    const res = mockRes();
    await getReplayAttribution(ctxReq({ replayEngine: mockEngine({ id: 'sess-1', status: 'playing' }), attributionCollector }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('returns 409 when the collector belongs to another session', async () => {
    const attributionCollector = { activeSessionId: 'other', getAttribution: jest.fn() };
    const res = mockRes();
    await getReplayAttribution(ctxReq({ replayEngine: mockEngine({ id: 'sess-1', status: 'completed' }), attributionCollector }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('returns the report for a completed session', async () => {
    const attributionCollector = { activeSessionId: 'sess-1', getAttribution: jest.fn().mockReturnValue(report) };
    const res = mockRes();
    await getReplayAttribution(ctxReq({ replayEngine: mockEngine({ id: 'sess-1', status: 'completed' }), attributionCollector }), res);
    expect(res.json).toHaveBeenCalledWith(report);
  });
});
