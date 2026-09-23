jest.mock('../../config/env', () => ({ env: { logLevel: 'error' } }));

import { BacktestWorker, type BacktestJobQueue } from '../../core/backtest/backtestWorker';
import type { BacktestEngine } from '../../core/backtest/backtestEngine';
import type { BacktestJob, BacktestJobProgress } from '../../types/backtestJob';
import type { BacktestConfig, BacktestResult } from '../../types/backtest';

type RunFn = (
  config: BacktestConfig,
  factory: () => unknown,
  onProgress: (p: BacktestJobProgress) => void,
  options: { signal: AbortSignal },
) => Promise<BacktestResult>;

const RESULT = { id: 'job-1', status: 'completed', orders: [], fills: [] } as unknown as BacktestResult;
const POINT: BacktestJobProgress = { ts: 1, equity: 100_000, barIndex: 10, totalBars: 100 };

function makeJob(): BacktestJob {
  return {
    id: 'job-1',
    configKey: 'k',
    config: { id: 'job-1' } as BacktestConfig,
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
  };
}

function makeQueue(overrides: Partial<Record<keyof BacktestJobQueue, jest.Mock>> = {}) {
  const queue = {
    claim: jest.fn().mockResolvedValue(makeJob()),
    touch: jest.fn().mockResolvedValue(true),
    writeArtifacts: jest.fn().mockResolvedValue(undefined),
    complete: jest.fn().mockResolvedValue(true),
    fail: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(true),
    sweep: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
  return queue as typeof queue & BacktestJobQueue;
}

function makeWorker(queue: BacktestJobQueue, run: RunFn) {
  const engine = { run } as unknown as BacktestEngine;
  return new BacktestWorker('w1', queue, () => engine, () => [], {
    heartbeatMs: 60_000,
    progressMs: 0,
    pollMs: 10,
    sweepMs: 60_000,
  });
}

const tick = () => new Promise<void>((r) => setImmediate(r));

describe('BacktestWorker.runOnce', () => {
  it('returns false and does nothing when the queue is empty', async () => {
    const queue = makeQueue({ claim: jest.fn().mockResolvedValue(null) });
    const run = jest.fn();
    expect(await makeWorker(queue, run).runOnce()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('stages the result, then marks the job succeeded', async () => {
    const queue = makeQueue();
    const worker = makeWorker(queue, async () => RESULT);

    expect(await worker.runOnce()).toBe(true);

    expect(queue.writeArtifacts).toHaveBeenCalledWith('job-1', RESULT);
    expect(queue.complete).toHaveBeenCalledWith('job-1', 'w1');
    // Artifacts must exist before the job flips to succeeded, or a fast client
    // polling the job could see "succeeded" and find nothing to load.
    expect(queue.writeArtifacts.mock.invocationCallOrder[0]).toBeLessThan(queue.complete.mock.invocationCallOrder[0]);
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it('writes progress through the lease heartbeat', async () => {
    const queue = makeQueue();
    const worker = makeWorker(queue, async (_c, _f, onProgress) => {
      onProgress(POINT);
      await tick();
      return RESULT;
    });
    await worker.runOnce();
    expect(queue.touch).toHaveBeenCalledWith('job-1', 'w1', POINT);
  });

  it('records the engine error message when a run fails', async () => {
    const queue = makeQueue();
    const worker = makeWorker(queue, async () => { throw new Error('no bars for XYZ'); });
    await worker.runOnce();
    expect(queue.fail).toHaveBeenCalledWith('job-1', 'w1', 'no bars for XYZ');
    expect(queue.complete).not.toHaveBeenCalled();
  });

  it('abandons the run without writing anything when the lease is lost', async () => {
    const queue = makeQueue({ touch: jest.fn().mockResolvedValue(false) });
    const worker = makeWorker(queue, async (_c, _f, onProgress, { signal }) => {
      onProgress(POINT); // heartbeat answers "not yours anymore"
      await tick();
      await tick();
      signal.throwIfAborted();
      return RESULT;
    });

    await worker.runOnce();

    expect(queue.writeArtifacts).not.toHaveBeenCalled();
    expect(queue.complete).not.toHaveBeenCalled();
    // Not a failure: another worker now owns the job and will finish it.
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it('hands an in-flight job back to the queue on shutdown', async () => {
    const queue = makeQueue();
    const worker = makeWorker(queue, (_c, _f, _p, { signal }) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    );

    const running = worker.runOnce();
    await tick();
    await worker.stop();
    await running;

    expect(queue.release).toHaveBeenCalledWith('job-1', 'w1');
    expect(queue.fail).not.toHaveBeenCalled();
  });
});

describe('BacktestWorker loop', () => {
  it('keeps polling after a claim error and stops cleanly', async () => {
    const claim = jest.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(null);
    const queue = makeQueue({ claim });
    const worker = makeWorker(queue, async () => RESULT);

    const loop = worker.start();
    await new Promise((r) => setTimeout(r, 40));
    await worker.stop();
    await loop;

    expect(claim.mock.calls.length).toBeGreaterThan(1);
    expect(queue.sweep).toHaveBeenCalled();
  });
});
