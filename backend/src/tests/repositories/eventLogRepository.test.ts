jest.mock('../../adapters/supabase/client');
jest.mock('../../config/env', () => ({ env: { logLevel: 'error' } }));

import { getSupabaseClient } from '../../adapters/supabase/client';
import { insertEventLog, listEventLogs, getEventLog } from '../../adapters/supabase/eventLogRepository';
import type { TradingEvent } from '../../types/events';

function buildChain(overrides: Record<string, jest.Mock> = {}) {
  const chain: Record<string, jest.Mock> = {
    insert: jest.fn().mockResolvedValue({ error: null }),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: [], error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
  return chain;
}

const mockFrom = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (getSupabaseClient as jest.Mock).mockReturnValue({ from: mockFrom });
});

const row = {
  id: 'log-1',
  name: 'paper session',
  description: null,
  source: 'paper',
  run_id: null,
  event_count: 1,
  start_date: '2026-10-28T13:30:00.000Z',
  end_date: '2026-10-28T14:30:00.000Z',
  created_at: '2026-10-28T14:31:00.000Z',
};

const events = [{ id: 'e1', type: 'HEARTBEAT', ts: 1, mode: 'paper' }] as TradingEvent[];

describe('insertEventLog', () => {
  it('writes the snake_case row with its events', async () => {
    const chain = buildChain();
    mockFrom.mockReturnValue(chain);
    await insertEventLog(
      { id: 'log-1', name: 'n', source: 'paper', eventCount: 1, startDate: row.start_date, endDate: row.end_date },
      events,
    );
    expect(mockFrom).toHaveBeenCalledWith('event_logs');
    expect(chain.insert.mock.calls[0][0]).toMatchObject({
      id: 'log-1', source: 'paper', run_id: null, event_count: 1, events,
    });
  });

  it('throws on a Supabase error', async () => {
    mockFrom.mockReturnValue(buildChain({ insert: jest.fn().mockResolvedValue({ error: { message: 'boom' } }) }));
    await expect(
      insertEventLog({ id: 'x', name: 'n', source: 'paper', eventCount: 0, startDate: '', endDate: '' }, []),
    ).rejects.toThrow(/boom/);
  });
});

describe('listEventLogs', () => {
  it('selects metadata only and maps to EventLogRecord', async () => {
    const chain = buildChain({ order: jest.fn().mockResolvedValue({ data: [row], error: null }) });
    mockFrom.mockReturnValue(chain);
    const logs = await listEventLogs();
    expect(chain.select.mock.calls[0][0]).not.toContain('events');
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(logs).toEqual([{
      id: 'log-1', name: 'paper session', description: undefined, source: 'paper', runId: undefined,
      eventCount: 1, startDate: row.start_date, endDate: row.end_date,
      createdAt: new Date(row.created_at).getTime(),
    }]);
  });

  it('throws on a Supabase error', async () => {
    mockFrom.mockReturnValue(buildChain({ order: jest.fn().mockResolvedValue({ data: null, error: { message: 'down' } }) }));
    await expect(listEventLogs()).rejects.toThrow(/down/);
  });
});

describe('getEventLog', () => {
  it('returns null when the log does not exist', async () => {
    mockFrom.mockReturnValue(buildChain());
    await expect(getEventLog('missing')).resolves.toBeNull();
  });

  it('returns the record and its events', async () => {
    const chain = buildChain({ maybeSingle: jest.fn().mockResolvedValue({ data: { ...row, events }, error: null }) });
    mockFrom.mockReturnValue(chain);
    const log = await getEventLog('log-1');
    expect(chain.eq).toHaveBeenCalledWith('id', 'log-1');
    expect(log!.record.id).toBe('log-1');
    expect(log!.events).toEqual(events);
  });
});
