const readBars = jest.fn();
const getCompleteDays = jest.fn();

jest.mock('../../adapters/supabase/barCacheRepository', () => ({
  SupabaseBarCache: jest.fn().mockImplementation(() => ({ readBars, getCompleteDays })),
}));
jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import type { Request, Response } from 'express';
import { getCachedBars } from '../../app/controllers/marketDataController';

function mockRes() {
  const res = { json: jest.fn(), status: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response & { json: jest.Mock; status: jest.Mock };
}

const req = (query: Record<string, string>) => ({ query } as unknown as Request);

beforeEach(() => jest.clearAllMocks());

describe('getCachedBars', () => {
  it('returns cached bars and complete days from the bar cache only', async () => {
    readBars.mockResolvedValue([{ symbol: 'SPY', ts: 1 }]);
    getCompleteDays.mockResolvedValue(new Set(['2026-10-07', '2026-10-06']));
    const res = mockRes();
    await getCachedBars(req({ symbol: 'spy', from: '2026-10-06', to: '2026-10-08' }), res);
    expect(readBars).toHaveBeenCalledWith('SPY', '1Min', Date.parse('2026-10-06'), Date.parse('2026-10-08'));
    expect(res.json).toHaveBeenCalledWith({
      symbol: 'SPY', timeframe: '1Min', bars: [{ symbol: 'SPY', ts: 1 }], completeDays: ['2026-10-06', '2026-10-07'],
    });
  });

  it('rejects a missing or inverted range', async () => {
    const res = mockRes();
    await getCachedBars(req({ symbol: 'SPY', from: '2026-10-08', to: '2026-10-06' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(readBars).not.toHaveBeenCalled();
  });

  it('caps one request at 31 days', async () => {
    const res = mockRes();
    await getCachedBars(req({ symbol: 'SPY', from: '2026-01-01', to: '2026-03-01' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
