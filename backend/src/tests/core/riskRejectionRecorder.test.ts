jest.mock('../../config/env', () => ({ env: { logLevel: 'error' } }));

import { RiskRejectionRecorder, type RejectionInput } from '../../core/live/riskRejectionRecorder';

function rejection(overrides: Partial<RejectionInput> = {}): RejectionInput {
  return {
    ts: Date.parse('2024-06-03T15:00:00Z'),
    strategyId: 'strat-1',
    symbol: 'XOM',
    failedCheck: 'STRATEGY_BUDGET',
    reason: 'over budget',
    intent: { id: 'i1' },
    ...overrides,
  };
}

describe('RiskRejectionRecorder', () => {
  it('writes buffered rejections in one batch, stamped with the accountable member', async () => {
    const insert = jest.fn(async () => {});
    const resolveOwner = jest.fn(async () => 'user-author');
    const recorder = new RiskRejectionRecorder({ insert, resolveOwner });

    recorder.record(rejection());
    recorder.record(rejection({ failedCheck: 'CAPITAL_UNAVAILABLE' }));
    await recorder.flush();

    expect(insert).toHaveBeenCalledTimes(1);
    const rows = (insert.mock.calls[0] as unknown[])[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      strategy_id: 'strat-1',
      owner_id: 'user-author',
      symbol: 'XOM',
      failed_check: 'STRATEGY_BUDGET',
      ts: '2024-06-03T15:00:00.000Z',
    });
    // One owner lookup for both rows.
    expect(resolveOwner).toHaveBeenCalledTimes(1);
  });

  it('keeps rows and retries after a failed write', async () => {
    const insert = jest.fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(undefined);
    const recorder = new RiskRejectionRecorder({ insert, resolveOwner: async () => null });

    recorder.record(rejection());
    await recorder.flush();
    recorder.record(rejection({ symbol: 'CVX' }));
    await recorder.flush();

    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[1][0]).toHaveLength(2);
  });

  it('bounds memory during an outage by dropping the oldest rows', async () => {
    const insert = jest.fn().mockRejectedValue(new Error('db down'));
    const recorder = new RiskRejectionRecorder({ insert, resolveOwner: async () => null }, { maxBuffered: 3 });

    for (let i = 0; i < 5; i++) recorder.record(rejection({ symbol: `S${i}` }));
    insert.mockResolvedValue(undefined);
    await recorder.flush();

    const rows = insert.mock.calls.at(-1)![0] as Record<string, unknown>[];
    expect(rows.map((r) => r.symbol)).toEqual(['S2', 'S3', 'S4']);
  });

  it('caches owner lookups across flushes until they go stale', async () => {
    const now = { t: 0 };
    const resolveOwner = jest.fn(async () => 'u1');
    const recorder = new RiskRejectionRecorder(
      { insert: async () => {}, resolveOwner, now: () => now.t },
      { ownerCacheMs: 1_000 },
    );

    recorder.record(rejection()); await recorder.flush();
    recorder.record(rejection()); await recorder.flush();
    expect(resolveOwner).toHaveBeenCalledTimes(1);

    now.t = 5_000;
    recorder.record(rejection()); await recorder.flush();
    expect(resolveOwner).toHaveBeenCalledTimes(2);
  });

  it('does nothing when there is nothing to write', async () => {
    const insert = jest.fn();
    await new RiskRejectionRecorder({ insert, resolveOwner: async () => null }).flush();
    expect(insert).not.toHaveBeenCalled();
  });
});
