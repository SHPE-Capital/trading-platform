jest.mock('../../config/env', () => ({ env: { logLevel: 'error' } }));

import { EventBus } from '../../core/engine/eventBus';
import { EventRecorder, eventLogFor } from '../../core/replay/eventRecorder';
import type { TradingEvent } from '../../types/events';

function heartbeat(ts: number): TradingEvent {
  return { id: `e-${ts}`, type: 'HEARTBEAT', ts, mode: 'paper' } as TradingEvent;
}

describe('EventRecorder', () => {
  it('records events published between start and stop, in order', () => {
    const bus = new EventBus();
    const recorder = new EventRecorder(bus, 10);
    bus.publish(heartbeat(0));
    recorder.start();
    bus.publish(heartbeat(1));
    bus.publish(heartbeat(2));
    const { events, dropped } = recorder.stop();
    bus.publish(heartbeat(3));
    expect(events.map((e) => e.ts)).toEqual([1, 2]);
    expect(dropped).toBe(0);
  });

  it('unsubscribes on stop', () => {
    const bus = new EventBus();
    const recorder = new EventRecorder(bus, 10);
    recorder.start();
    expect(bus.handlerCount()).toBe(1);
    recorder.stop();
    expect(bus.handlerCount()).toBe(0);
    expect(recorder.isRecording).toBe(false);
  });

  it('keeps the newest maxEvents and counts the dropped ones', () => {
    const bus = new EventBus();
    const recorder = new EventRecorder(bus, 3);
    recorder.start();
    for (let ts = 1; ts <= 7; ts++) bus.publish(heartbeat(ts));
    const { events, dropped } = recorder.stop();
    expect(events.map((e) => e.ts)).toEqual([5, 6, 7]);
    expect(dropped).toBe(4);
  });

  it('does not record REPLAY_TICK', () => {
    const bus = new EventBus();
    const recorder = new EventRecorder(bus, 10);
    recorder.start();
    bus.publish({ id: 't', type: 'REPLAY_TICK', ts: 1, mode: 'replay' } as unknown as TradingEvent);
    expect(recorder.stop().events).toHaveLength(0);
  });

  it('rejects a non-positive cap', () => {
    expect(() => new EventRecorder(new EventBus(), 0)).toThrow();
  });
});

describe('eventLogFor', () => {
  it('covers the period of the recorded events', () => {
    const log = eventLogFor('log-1', 'paper', { events: [heartbeat(1_000), heartbeat(61_000)], dropped: 0 });
    expect(log).toMatchObject({
      id: 'log-1',
      source: 'paper',
      eventCount: 2,
      startDate: new Date(1_000).toISOString(),
      endDate: new Date(61_000).toISOString(),
      description: undefined,
    });
  });

  it('notes dropped events in the description', () => {
    const log = eventLogFor('log-1', 'live', { events: [heartbeat(1)], dropped: 5 });
    expect(log.description).toMatch(/5 events dropped/);
  });
});
