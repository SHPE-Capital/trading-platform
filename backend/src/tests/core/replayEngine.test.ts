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
    jest.spyOn(eventBus, 'publish');
    const engine = new ReplayEngine(eventBus);
    engine.load(makeSession());

    engine.control({ action: 'step' });
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
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
    jest.spyOn(eventBus, 'publish');
    const engine = new ReplayEngine(eventBus);
    engine.load(makeSession({ speed: 'step' }));
    engine.control({ action: 'play' });
    jest.runAllTimers();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('play emits all events after timer advances', () => {
    const eventBus = new EventBus();
    jest.spyOn(eventBus, 'publish');
    const engine = new ReplayEngine(eventBus);
    engine.load(makeSession({ speed: 1 })); // events at ts=1000,2000,3000

    engine.control({ action: 'play' });
    jest.advanceTimersByTime(1_000); // first timer fires: emits event[0], schedules next
    jest.advanceTimersByTime(1_000); // second timer fires: emits event[1], immediately emits event[2]

    expect(eventBus.publish).toHaveBeenCalledTimes(3);
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
