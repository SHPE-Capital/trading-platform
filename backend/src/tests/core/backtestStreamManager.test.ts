jest.mock('../../config/env', () => ({ env: { logLevel: 'error' } }));

import type { Response } from 'express';
import { BacktestStreamManager } from '../../core/backtest/backtestStreamManager';
import type { BacktestJob } from '../../types/backtestJob';

function job(overrides: Partial<BacktestJob> = {}): BacktestJob {
  return {
    id: 'job-1',
    configKey: 'k',
    config: {} as BacktestJob['config'],
    status: 'running',
    leaseOwner: 'w1',
    leaseExpiresAt: null,
    resultId: null,
    errorMessage: null,
    attempts: 1,
    requestedBy: null,
    progress: null,
    createdAt: 0,
    startedAt: 0,
    finishedAt: null,
    resultExpiresAt: null,
    ...overrides,
  };
}

/** Minimal SSE response double that records the events written to it. */
function fakeRes() {
  const chunks: string[] = [];
  const res = {
    writableEnded: false,
    headersSent: false,
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn((chunk: string) => { chunks.push(chunk); return true; }),
    end: jest.fn(() => { res.writableEnded = true; }),
  };
  const events = () =>
    chunks
      .filter((c) => c.startsWith('event:'))
      .map((c) => {
        const [evLine, dataLine] = c.trim().split('\n');
        return { event: evLine.slice('event: '.length), data: JSON.parse(dataLine.slice('data: '.length)) };
      });
  return { res: res as unknown as Response, raw: res, events };
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('BacktestStreamManager', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns null for an id that is neither a job nor a saved result', async () => {
    const mgr = new BacktestStreamManager({
      getJob: async () => null,
      savedResultExists: async () => false,
    });
    expect(await mgr.subscribe('nope', fakeRes().res)).toBeNull();
  });

  it('completes immediately for a saved result (a reused run has no job)', async () => {
    const mgr = new BacktestStreamManager({
      getJob: async () => null,
      savedResultExists: async () => true,
    });
    const { res, raw, events } = fakeRes();
    await mgr.subscribe('saved-1', res);
    expect(events()).toEqual([{ event: 'complete', data: { backtestId: 'saved-1' } }]);
    expect(raw.end).toHaveBeenCalled();
  });

  it('answers a finished job without starting a poll loop', async () => {
    const mgr = new BacktestStreamManager({
      getJob: async () => job({ status: 'failed', errorMessage: 'no bars' }),
      savedResultExists: async () => false,
    });
    const { res, events } = fakeRes();
    await mgr.subscribe('job-1', res);
    expect(events()).toEqual([{ event: 'error', data: { message: 'no bars' } }]);
    expect(mgr.activeChannels()).toBe(0);
  });

  it('relays status, progress, then completion as the worker updates the row', async () => {
    let current = job({ status: 'queued' });
    const mgr = new BacktestStreamManager(
      { getJob: async () => current, savedResultExists: async () => false },
      1_000,
    );
    const { res, raw, events } = fakeRes();
    await mgr.subscribe('job-1', res);
    expect(events()).toEqual([{ event: 'status', data: { status: 'queued' } }]);

    current = job({ status: 'running', progress: { ts: 1, equity: 1, barIndex: 5, totalBars: 10 } });
    jest.advanceTimersByTime(1_000);
    await flush();

    current = job({ status: 'succeeded' });
    jest.advanceTimersByTime(1_000);
    await flush();

    expect(events()).toEqual([
      { event: 'status', data: { status: 'queued' } },
      { event: 'status', data: { status: 'running' } },
      { event: 'progress', data: { ts: 1, equity: 1, barIndex: 5, totalBars: 10 } },
      { event: 'complete', data: { backtestId: 'job-1' } },
    ]);
    expect(raw.end).toHaveBeenCalled();
    expect(mgr.activeChannels()).toBe(0);
  });

  it('shares one poll loop across tabs and stops it when the last tab leaves', async () => {
    const getJob = jest.fn(async () => job());
    const mgr = new BacktestStreamManager({ getJob, savedResultExists: async () => false }, 1_000);

    const a = await mgr.subscribe('job-1', fakeRes().res);
    const b = await mgr.subscribe('job-1', fakeRes().res);
    expect(mgr.activeChannels()).toBe(1);

    a!();
    expect(mgr.activeChannels()).toBe(1);
    b!();
    expect(mgr.activeChannels()).toBe(0);

    getJob.mockClear();
    jest.advanceTimersByTime(5_000);
    await flush();
    expect(getJob).not.toHaveBeenCalled();
  });
});
