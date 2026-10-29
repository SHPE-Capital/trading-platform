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

  it('returns 400 for an action the engine does not implement', async () => {
    const replayEngine = mockEngine({ id: 's', status: 'paused' });
    const res = mockRes();
    await controlReplay(ctxReq({ replayEngine }, { action: 'launch' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(replayEngine.control).not.toHaveBeenCalled();
  });

  // A speed outside the ReplaySpeed set reaches the engine as the divisor of the
  // inter-event gap: 0 and non-numeric speeds make the delay Infinity/NaN, which
  // setTimeout floors to 1ms, so the replay runs flat out instead of slowing.
  it.each([0, -1, 3, 'fast', null, NaN])('returns 400 for set_speed %p', async (speed) => {
    const replayEngine = mockEngine({ id: 's', status: 'paused' });
    const res = mockRes();
    await controlReplay(ctxReq({ replayEngine }, { action: 'set_speed', speed }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(replayEngine.control).not.toHaveBeenCalled();
  });

  it.each([0.25, 0.5, 1, 2, 5, 10, 'step'])('accepts set_speed %p', async (speed) => {
    const replayEngine = mockEngine({ id: 's', status: 'paused' });
    const res = mockRes();
    await controlReplay(ctxReq({ replayEngine }, { action: 'set_speed', speed }), res);
    expect(replayEngine.control).toHaveBeenCalledWith({ action: 'set_speed', speed });
    expect(res.status).not.toHaveBeenCalledWith(400);
  });

  // A non-integer targetIndex clamps to NaN inside the engine, which wedges the
  // session: the cursor serializes as null and the next step throws.
  it.each([undefined, 'abc', -1, 1.5, null, NaN, Infinity])('returns 400 for seek targetIndex %p', async (targetIndex) => {
    const replayEngine = mockEngine({ id: 's', status: 'paused' });
    const res = mockRes();
    await controlReplay(ctxReq({ replayEngine }, { action: 'seek', targetIndex }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(replayEngine.control).not.toHaveBeenCalled();
  });

  it('accepts seek with a non-negative integer targetIndex', async () => {
    const replayEngine = mockEngine({ id: 's', status: 'paused' });
    const res = mockRes();
    await controlReplay(ctxReq({ replayEngine }, { action: 'seek', targetIndex: 0 }), res);
    expect(replayEngine.control).toHaveBeenCalledWith({ action: 'seek', targetIndex: 0 });
  });

  it.each([undefined, 'abc', null, NaN, Infinity])('returns 400 for seek_ts targetTs %p', async (targetTs) => {
    const replayEngine = mockEngine({ id: 's', status: 'paused' });
    const res = mockRes();
    await controlReplay(ctxReq({ replayEngine }, { action: 'seek_ts', targetTs }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(replayEngine.control).not.toHaveBeenCalled();
  });

  it('accepts seek_ts with a finite targetTs', async () => {
    const replayEngine = mockEngine({ id: 's', status: 'paused' });
    const res = mockRes();
    await controlReplay(ctxReq({ replayEngine }, { action: 'seek_ts', targetTs: 1_000 }), res);
    expect(replayEngine.control).toHaveBeenCalledWith({ action: 'seek_ts', targetTs: 1_000 });
  });
});

describe('controlReplay attribution', () => {
  it('restarts attribution on reset and seek, not on play', async () => {
    const replayEngine = mockEngine({ id: 's', status: 'paused' });
    const attributionCollector = { start: jest.fn() };
    const commands = [
      { action: 'play' },
      { action: 'reset' },
      { action: 'seek', targetIndex: 0 },
      { action: 'seek_ts', targetTs: 1_000 },
    ];
    for (const command of commands) {
      await controlReplay(ctxReq({ replayEngine, attributionCollector }, command), mockRes());
    }
    expect(attributionCollector.start).toHaveBeenCalledTimes(3);
    expect(attributionCollector.start).toHaveBeenCalledWith('s');
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
