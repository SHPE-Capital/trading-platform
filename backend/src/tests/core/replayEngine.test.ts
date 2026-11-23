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

import { EventBus } from '../../core/engine/eventBus';
import { ReplayEngine } from '../../core/replay/replayEngine';
import { nowMs, lockClockForLive, unlockClockForLive } from '../../utils/time';
import type { ReplaySession } from '../../types/replay';
import type { TradingEvent as TE } from '../../types/events';

function makeEvents(count = 3): TE[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `evt-${i}`,
    type: 'HEARTBEAT' as const,
    ts: (i + 1) * 1_000,
    mode: 'replay' as const,
  }));
}

/** Recorded events the engine re-published, leaving out its REPLAY_TICKs. */
function replayed(publish: jest.SpyInstance): TE[] {
  return publish.mock.calls.map(([e]) => e as TE).filter((e) => e.type !== 'REPLAY_TICK');
}

function ticks(publish: jest.SpyInstance): TE[] {
  return publish.mock.calls.map(([e]) => e as TE).filter((e) => e.type === 'REPLAY_TICK');
}

function makeSession(overrides: Partial<ReplaySession> = {}): ReplaySession {
  const events = makeEvents(3);
  return {
    id: 'session-1',
    name: 'Test Session',
    events,
    totalEvents: events.length,
    cursor: 0,
    status: 'idle',
    speed: 1,
    replayStrategies: false,
    simulatedNow: events[0].ts,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('load / getSession', () => {
  it('load makes session accessible via getSession', () => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession());
    expect(engine.getSession()).not.toBeNull();
    expect(engine.getSession()!.id).toBe('session-1');
  });

  it('getSession returns null when no session is loaded', () => {
    expect(new ReplayEngine(new EventBus()).getSession()).toBeNull();
  });

  it('getSession returns a shallow copy — mutations do not affect internal state', () => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession());
    const copy = engine.getSession()!;
    copy.cursor = 99;
    expect(engine.getSession()!.cursor).toBe(0);
  });

  it('loading a new session replaces the previous one', () => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession({ id: 'session-A' }));
    engine.load(makeSession({ id: 'session-B' }));
    expect(engine.getSession()!.id).toBe('session-B');
  });
});

describe('step command', () => {
  it('step emits one event and advances cursor', () => {
    const eventBus = new EventBus();
    const publish = jest.spyOn(eventBus, 'publish');
    const engine = new ReplayEngine(eventBus);
    engine.load(makeSession());

    engine.control({ action: 'step' });
    expect(replayed(publish)).toHaveLength(1);
    expect(engine.getSession()!.cursor).toBe(1);
  });

  it('step through all events → status becomes completed after last', () => {
    const eventBus = new EventBus();
    const engine = new ReplayEngine(eventBus);
    const session = makeSession();
    engine.load(session);

    engine.control({ action: 'step' });
    engine.control({ action: 'step' });
    engine.control({ action: 'step' });
    expect(engine.getSession()!.status).toBe('completed');
  });

  it('step updates simulatedNow to the emitted event ts', () => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession());
    engine.control({ action: 'step' });
    expect(engine.getSession()!.simulatedNow).toBe(1_000);
  });

  it('step beyond all events does not throw', () => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession());
    for (let i = 0; i < 10; i++) {
      expect(() => engine.control({ action: 'step' })).not.toThrow();
    }
  });
});

describe('pause command', () => {
  it('pause sets status to paused', () => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession({ status: 'playing' }));
    engine.control({ action: 'pause' });
    expect(engine.getSession()!.status).toBe('paused');
  });
});

describe('seek command', () => {
  it('seek moves cursor to the target index', () => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession());
    engine.control({ action: 'seek', targetIndex: 2 });
    expect(engine.getSession()!.cursor).toBe(2);
  });

  it('seek clamps to 0 for negative indices', () => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession());
    engine.control({ action: 'seek', targetIndex: -5 });
    expect(engine.getSession()!.cursor).toBe(0);
  });

  it('seek clamps to totalEvents-1 for out-of-bounds indices', () => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession());
    engine.control({ action: 'seek', targetIndex: 999 });
    expect(engine.getSession()!.cursor).toBe(2); // totalEvents-1
  });

  // Without the guard the clamp yields NaN, so the cursor points at no event
  // and the next step throws on `event.ts`.
  it.each([NaN, Infinity, -Infinity])('seek ignores the non-finite index %p', (targetIndex) => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession());
    engine.control({ action: 'seek', targetIndex: 1 });
    engine.control({ action: 'seek', targetIndex });
    expect(engine.getSession()!.cursor).toBe(1);
    expect(() => engine.control({ action: 'step' })).not.toThrow();
  });
});

describe('seek_ts command', () => {
  it('moves the cursor to the first event at or after the timestamp', () => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession()); // events at ts=1000,2000,3000
    engine.control({ action: 'seek_ts', targetTs: 1_500 });
    expect(engine.getSession()!.cursor).toBe(1);
    engine.control({ action: 'seek_ts', targetTs: 3_000 });
    expect(engine.getSession()!.cursor).toBe(2);
  });

  it('clamps to the first and last events', () => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession());
    engine.control({ action: 'seek_ts', targetTs: 0 });
    expect(engine.getSession()!.cursor).toBe(0);
    engine.control({ action: 'seek_ts', targetTs: 99_000 });
    expect(engine.getSession()!.cursor).toBe(2);
  });
});

describe('set_speed command', () => {
  it('set_speed updates session.speed', () => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession());
    engine.control({ action: 'set_speed', speed: 5 });
    expect(engine.getSession()!.speed).toBe(5);
  });
});

describe('reset command', () => {
  it('reset sets cursor to 0 and status to paused', () => {
    const engine = new ReplayEngine(new EventBus());
    const session = makeSession();
    engine.load(session);
    engine.control({ action: 'step' });
    engine.control({ action: 'step' });
    engine.control({ action: 'reset' });
    const s = engine.getSession()!;
    expect(s.cursor).toBe(0);
    expect(s.status).toBe('paused');
  });

  it('reset restores simulatedNow to the first event ts', () => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession());
    engine.control({ action: 'step' });
    engine.control({ action: 'reset' });
    expect(engine.getSession()!.simulatedNow).toBe(1_000);
  });
});

describe('play command', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('play sets status to playing', () => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession({ status: 'idle' }));
    engine.control({ action: 'play' });
    expect(engine.getSession()!.status).toBe('playing');
  });

  it('play with speed="step" sets status to playing but does not auto-emit events', () => {
    const eventBus = new EventBus();
    const publish = jest.spyOn(eventBus, 'publish');
    const engine = new ReplayEngine(eventBus);
    engine.load(makeSession({ speed: 'step' }));
    engine.control({ action: 'play' });
    jest.runAllTimers();
    expect(replayed(publish)).toHaveLength(0);
  });

  it('play emits all events after timer advances', () => {
    const eventBus = new EventBus();
    const publish = jest.spyOn(eventBus, 'publish');
    const engine = new ReplayEngine(eventBus);
    engine.load(makeSession({ speed: 1 })); // events at ts=1000,2000,3000

    engine.control({ action: 'play' });
    jest.advanceTimersByTime(1_000); // first timer fires: emits event[0], schedules next
    jest.advanceTimersByTime(1_000); // second timer fires: emits event[1], immediately emits event[2]

    expect(replayed(publish)).toHaveLength(3);
    expect(engine.getSession()!.status).toBe('completed');
  });
});

describe('stop', () => {
  it('stop unloads the session', () => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession());
    engine.stop();
    expect(engine.getSession()).toBeNull();
  });
});

describe('control without session', () => {
  it('all commands do not throw when no session is loaded', () => {
    const engine = new ReplayEngine(new EventBus());
    expect(() => engine.control({ action: 'step' })).not.toThrow();
    expect(() => engine.control({ action: 'pause' })).not.toThrow();
    expect(() => engine.control({ action: 'play' })).not.toThrow();
    expect(() => engine.control({ action: 'reset' })).not.toThrow();
  });
});

describe('simulated clock', () => {
  afterEach(() => unlockClockForLive());

  it('handlers see the recorded event ts as nowMs()', () => {
    const eventBus = new EventBus();
    const seen: Array<[number, number]> = [];
    eventBus.on('HEARTBEAT', (e) => { seen.push([e.ts, nowMs()]); });
    const engine = new ReplayEngine(eventBus);
    engine.load(makeSession());
    engine.control({ action: 'step' });
    engine.control({ action: 'step' });
    expect(seen).toEqual([[1_000, 1_000], [2_000, 2_000]]);
  });

  it('restores the wall clock after each publish', () => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession());
    engine.control({ action: 'step' });
    expect(Math.abs(nowMs() - Date.now())).toBeLessThan(1_000);
  });

  it('keeps the wall clock in a process a trading engine has locked', () => {
    lockClockForLive('paper');
    const eventBus = new EventBus();
    let seen = 0;
    eventBus.on('HEARTBEAT', () => { seen = nowMs(); });
    const engine = new ReplayEngine(eventBus);
    engine.load(makeSession());
    expect(() => engine.control({ action: 'step' })).not.toThrow();
    expect(seen).toBeGreaterThan(1_000_000);
  });
});

describe('REPLAY_TICK', () => {
  it('publishes the session state after every command', () => {
    const eventBus = new EventBus();
    const publish = jest.spyOn(eventBus, 'publish');
    const engine = new ReplayEngine(eventBus);
    engine.load(makeSession());
    engine.control({ action: 'step' });
    engine.control({ action: 'set_speed', speed: 2 });
    const t = ticks(publish) as unknown as Array<Record<string, unknown>>;
    expect(t).toHaveLength(2);
    expect(t[1]).toMatchObject({ sessionId: 'session-1', cursor: 1, totalEvents: 3, speed: 2, simulatedNow: 1_000, mode: 'replay' });
  });

  it('publishes a completed tick when the last event is emitted', () => {
    const eventBus = new EventBus();
    const publish = jest.spyOn(eventBus, 'publish');
    const engine = new ReplayEngine(eventBus);
    engine.load(makeSession());
    for (let i = 0; i < 3; i++) engine.control({ action: 'step' });
    const statuses = (ticks(publish) as unknown as Array<{ status: string }>).map((t) => t.status);
    expect(statuses).toContain('completed');
  });

  it('is not published without a session', () => {
    const eventBus = new EventBus();
    const publish = jest.spyOn(eventBus, 'publish');
    new ReplayEngine(eventBus).control({ action: 'play' });
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('getStatus', () => {
  it('returns the session without its events', () => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession());
    const status = engine.getStatus()!;
    expect(status).not.toHaveProperty('events');
    expect(status).toMatchObject({ id: 'session-1', totalEvents: 3, cursor: 0 });
  });

  it('seeking a completed session makes it playable again', () => {
    const engine = new ReplayEngine(new EventBus());
    engine.load(makeSession());
    for (let i = 0; i < 3; i++) engine.control({ action: 'step' });
    engine.control({ action: 'seek', targetIndex: 0 });
    expect(engine.getStatus()!.status).toBe('paused');
  });
});
