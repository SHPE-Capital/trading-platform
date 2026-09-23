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

jest.mock('../../adapters/supabase/reviewRepositories');
jest.mock('../../adapters/supabase/repositories');

import type { Request, Response } from 'express';
import * as review from '../../adapters/supabase/reviewRepositories';
import * as repos from '../../adapters/supabase/repositories';
import {
  approveProposal,
  rejectProposal,
  withdrawProposal,
  createProposal,
  createVersion,
  addComment,
} from '../../app/controllers/proposalsController';
import type { StrategyProposal, StrategyVersion } from '../../types/review';

const mockSettle = review.settleProposal as jest.Mock;
const mockReopen = review.reopenProposal as jest.Mock;
const mockGetProposal = review.getProposalById as jest.Mock;
const mockGetVersion = review.getStrategyVersionById as jest.Mock;
const mockGetOpen = review.getOpenProposalForStrategy as jest.Mock;
const mockGetLatest = review.getLatestStrategyVersion as jest.Mock;
const mockInsertProposal = review.insertProposal as jest.Mock;
const mockInsertVersion = review.insertStrategyVersion as jest.Mock;
const mockUpdateHead = review.updateProposalHead as jest.Mock;
const mockInsertComment = review.insertComment as jest.Mock;
const mockInsertRun = repos.insertStrategyRun as jest.Mock;
const mockGetStrategy = repos.getStrategyById as jest.Mock;
const mockUpdateStrategy = repos.updateStrategy as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProposal(overrides: Partial<StrategyProposal> = {}): StrategyProposal {
  return {
    id: 'prop-1',
    strategyId: 'strat-1',
    headVersionId: 'ver-1',
    title: 'Promote XOM/CVX v3',
    description: 'Hysteresis tuned, 5 backtests clean.',
    status: 'open',
    requestedBy: 'user-author',
    requestedAt: 1_700_000_000_000,
    approvedBy: null,
    approvedAt: null,
    approvedCapitalPct: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeVersion(overrides: Partial<StrategyVersion> = {}): StrategyVersion {
  return {
    id: 'ver-1',
    strategyId: 'strat-1',
    versionNumber: 3,
    config: {
      id: 'strat-1',
      type: 'pairs_trading',
      name: 'Pairs: XOM/CVX',
      symbols: ['XOM', 'CVX'],
      riskBudget: { maxCapitalPct: 0.4 },
    } as never,
    changeSummary: 'Widened the spread window',
    createdBy: 'user-author',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

const orchestrator = {
  registerStrategy: jest.fn(),
  deregisterStrategy: jest.fn(),
  hasStrategy: jest.fn(),
  hasStrategyWithConfigId: jest.fn(),
};

function mockReq(overrides: Partial<Request> = {}, role: 'member' | 'lead' = 'lead'): Request {
  return {
    body: {},
    params: {},
    query: {},
    user: { id: 'user-lead', email: 'lead@shpe.test', role, displayName: 'Lead' },
    app: { locals: { ctx: { orchestrator, executionMode: 'paper' } } },
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; payload: unknown } {
  const res = {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.payload = body; return this; },
  };
  return res as unknown as Response & { statusCode: number; payload: unknown };
}

beforeEach(() => {
  jest.clearAllMocks();
  orchestrator.registerStrategy.mockReset();
  orchestrator.deregisterStrategy.mockReset();
});

// ---------------------------------------------------------------------------
// Approve — the only path that puts a strategy live
// ---------------------------------------------------------------------------
describe('approveProposal', () => {
  it('settles the proposal, registers the strategy, and writes one run', async () => {
    mockGetProposal.mockResolvedValue(makeProposal());
    mockGetVersion.mockResolvedValue(makeVersion());
    mockSettle.mockResolvedValue(makeProposal({ status: 'approved', approvedBy: 'user-lead' }));
    mockInsertRun.mockResolvedValue(undefined);

    const res = mockRes();
    await approveProposal(mockReq({ params: { id: 'prop-1' } as never }), res);

    expect(res.statusCode).toBe(201);
    expect(orchestrator.registerStrategy).toHaveBeenCalledTimes(1);
    expect(mockInsertRun).toHaveBeenCalledTimes(1);

    // The run must cite the exact version and the proposal that authorised it.
    const run = mockInsertRun.mock.calls[0][0];
    expect(run.versionId).toBe('ver-1');
    expect(run.proposalId).toBe('prop-1');
    // Accountability stays with the author, not the approving lead.
    expect(run.ownerId).toBe('user-author');
    expect(run.status).toBe('running');
  });

  it('applies the approver capital override to the run config', async () => {
    mockGetProposal.mockResolvedValue(makeProposal());
    mockGetVersion.mockResolvedValue(makeVersion());
    mockSettle.mockResolvedValue(makeProposal({ status: 'approved' }));
    mockInsertRun.mockResolvedValue(undefined);

    const res = mockRes();
    await approveProposal(
      mockReq({ params: { id: 'prop-1' } as never, body: { approvedCapitalPct: 0.1 } }),
      res,
    );

    // Author proposed 0.4; the lead sized it down to 0.1 without a re-review.
    const run = mockInsertRun.mock.calls[0][0];
    expect(run.config.riskBudget.maxCapitalPct).toBe(0.1);
  });

  it('leaves the proposed riskBudget alone when no override is given', async () => {
    mockGetProposal.mockResolvedValue(makeProposal());
    mockGetVersion.mockResolvedValue(makeVersion());
    mockSettle.mockResolvedValue(makeProposal({ status: 'approved' }));
    mockInsertRun.mockResolvedValue(undefined);

    await approveProposal(mockReq({ params: { id: 'prop-1' } as never }), mockRes());

    expect(mockInsertRun.mock.calls[0][0].config.riskBudget.maxCapitalPct).toBe(0.4);
  });

  it('returns 409 when another lead settled it first', async () => {
    mockGetProposal.mockResolvedValue(makeProposal());
    mockGetVersion.mockResolvedValue(makeVersion());
    // The guarded UPDATE matched zero rows — someone else won the race.
    mockSettle.mockResolvedValue(null);

    const res = mockRes();
    await approveProposal(mockReq({ params: { id: 'prop-1' } as never }), res);

    expect(res.statusCode).toBe(409);
    expect(orchestrator.registerStrategy).not.toHaveBeenCalled();
    expect(mockInsertRun).not.toHaveBeenCalled();
  });

  it('reopens the proposal and deregisters when the run fails to persist', async () => {
    mockGetProposal.mockResolvedValue(makeProposal());
    mockGetVersion.mockResolvedValue(makeVersion());
    mockSettle.mockResolvedValue(makeProposal({ status: 'approved' }));
    mockInsertRun.mockRejectedValue(new Error('db down'));

    const res = mockRes();
    await approveProposal(mockReq({ params: { id: 'prop-1' } as never }), res);

    expect(res.statusCode).toBe(500);
    // Neither the engine nor the queue may be left claiming something that isn't true.
    expect(orchestrator.deregisterStrategy).toHaveBeenCalledTimes(1);
    expect(mockReopen).toHaveBeenCalledWith('prop-1');
  });

  it('rejects a capital override outside 0–1 before touching anything', async () => {
    const res = mockRes();
    await approveProposal(
      mockReq({ params: { id: 'prop-1' } as never, body: { approvedCapitalPct: 1.5 } }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('returns 503 on a process with no orchestrator', async () => {
    const res = mockRes();
    const req = mockReq({ params: { id: 'prop-1' } as never });
    (req.app.locals as { ctx: Record<string, unknown> }).ctx = {};

    await approveProposal(req, res);

    expect(res.statusCode).toBe(503);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('refuses a proposal that is not open', async () => {
    mockGetProposal.mockResolvedValue(makeProposal({ status: 'rejected' }));

    const res = mockRes();
    await approveProposal(mockReq({ params: { id: 'prop-1' } as never }), res);

    expect(res.statusCode).toBe(409);
    expect(mockSettle).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Reject / withdraw
// ---------------------------------------------------------------------------
describe('rejectProposal', () => {
  it('requires a reason so the author knows what to change', async () => {
    const res = mockRes();
    await rejectProposal(mockReq({ params: { id: 'prop-1' } as never, body: {} }), res);

    expect(res.statusCode).toBe(400);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('settles and records the reason as a request_changes comment', async () => {
    mockSettle.mockResolvedValue(makeProposal({ status: 'rejected' }));
    mockInsertComment.mockResolvedValue({});

    const res = mockRes();
    await rejectProposal(
      mockReq({ params: { id: 'prop-1' } as never, body: { reason: 'Only 1 backtest, need more' } }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(mockInsertComment).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'request_changes', body: 'Only 1 backtest, need more' }),
    );
  });
});

describe('withdrawProposal', () => {
  it('lets the author withdraw their own request', async () => {
    mockGetProposal.mockResolvedValue(makeProposal({ requestedBy: 'user-member' }));
    mockSettle.mockResolvedValue(makeProposal({ status: 'withdrawn' }));

    const req = mockReq({ params: { id: 'prop-1' } as never }, 'member');
    (req as { user: { id: string } }).user.id = 'user-member';

    const res = mockRes();
    await withdrawProposal(req, res);

    expect(res.statusCode).toBe(200);
  });

  it('refuses when a different member tries to withdraw it', async () => {
    mockGetProposal.mockResolvedValue(makeProposal({ requestedBy: 'someone-else' }));

    const req = mockReq({ params: { id: 'prop-1' } as never }, 'member');
    (req as { user: { id: string } }).user.id = 'user-member';

    const res = mockRes();
    await withdrawProposal(req, res);

    expect(res.statusCode).toBe(403);
    expect(mockSettle).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Create proposal
// ---------------------------------------------------------------------------
describe('createProposal', () => {
  it('refuses a second open proposal for the same strategy', async () => {
    mockGetOpen.mockResolvedValue(makeProposal());

    const res = mockRes();
    await createProposal(mockReq({ body: { strategyId: 'strat-1', title: 'Another' } }), res);

    expect(res.statusCode).toBe(409);
    expect(mockInsertProposal).not.toHaveBeenCalled();
  });

  it('defaults the head to the newest version when none is given', async () => {
    mockGetOpen.mockResolvedValue(null);
    mockGetLatest.mockResolvedValue(makeVersion({ id: 'ver-7', versionNumber: 7 }));
    mockGetVersion.mockResolvedValue(makeVersion({ id: 'ver-7', versionNumber: 7 }));
    mockInsertProposal.mockResolvedValue(makeProposal({ headVersionId: 'ver-7' }));

    const res = mockRes();
    await createProposal(mockReq({ body: { strategyId: 'strat-1', title: 'Promote v7' } }), res);

    expect(res.statusCode).toBe(201);
    expect(mockInsertProposal).toHaveBeenCalledWith(
      expect.objectContaining({ headVersionId: 'ver-7' }),
    );
  });

  it('refuses when the strategy has no versions to cite', async () => {
    mockGetOpen.mockResolvedValue(null);
    mockGetLatest.mockResolvedValue(null);

    const res = mockRes();
    await createProposal(mockReq({ body: { strategyId: 'strat-1', title: 'Nothing yet' } }), res);

    expect(res.statusCode).toBe(400);
  });

  it('refuses a version belonging to a different strategy', async () => {
    mockGetOpen.mockResolvedValue(null);
    mockGetVersion.mockResolvedValue(makeVersion({ strategyId: 'some-other-strategy' }));

    const res = mockRes();
    await createProposal(
      mockReq({ body: { strategyId: 'strat-1', headVersionId: 'ver-1', title: 'Mismatch' } }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(mockInsertProposal).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Versions — the auto-attach behaviour
// ---------------------------------------------------------------------------
describe('createVersion', () => {
  it('attaches a new version to the strategy\'s open proposal automatically', async () => {
    mockGetStrategy.mockResolvedValue({ id: 'strat-1', name: 'Pairs: XOM/CVX' });
    mockInsertVersion.mockResolvedValue(makeVersion({ id: 'ver-4', versionNumber: 4 }));
    mockUpdateStrategy.mockResolvedValue(undefined);
    mockGetOpen.mockResolvedValue(makeProposal());
    mockUpdateHead.mockResolvedValue(makeProposal({ headVersionId: 'ver-4' }));

    const res = mockRes();
    await createVersion(
      mockReq({
        params: { strategyId: 'strat-1' } as never,
        body: { config: { type: 'pairs_trading' }, changeSummary: 'Addressed review' },
      }),
      res,
    );

    expect(res.statusCode).toBe(201);
    // This is what replaces "edit from the review page" — push a tested version.
    expect(mockUpdateHead).toHaveBeenCalledWith('prop-1', 'ver-4');
    expect((res.payload as { attachedToProposalId: string }).attachedToProposalId).toBe('prop-1');
  });

  it('does not attach anything when there is no open proposal', async () => {
    mockGetStrategy.mockResolvedValue({ id: 'strat-1', name: 'Pairs: XOM/CVX' });
    mockInsertVersion.mockResolvedValue(makeVersion({ id: 'ver-2' }));
    mockUpdateStrategy.mockResolvedValue(undefined);
    mockGetOpen.mockResolvedValue(null);

    const res = mockRes();
    await createVersion(
      mockReq({ params: { strategyId: 'strat-1' } as never, body: { config: { type: 'pairs_trading' } } }),
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(mockUpdateHead).not.toHaveBeenCalled();
    expect((res.payload as { attachedToProposalId: string | null }).attachedToProposalId).toBeNull();
  });

  it('404s for a strategy that does not exist', async () => {
    mockGetStrategy.mockResolvedValue(null);

    const res = mockRes();
    await createVersion(
      mockReq({ params: { strategyId: 'nope' } as never, body: { config: {} } }),
      res,
    );

    expect(res.statusCode).toBe(404);
    expect(mockInsertVersion).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------
describe('addComment', () => {
  it('lets a member leave a plain comment', async () => {
    mockGetProposal.mockResolvedValue(makeProposal());
    mockInsertComment.mockResolvedValue({ id: 'c-1' });

    const res = mockRes();
    await addComment(
      mockReq({ params: { id: 'prop-1' } as never, body: { body: 'Nice spread window' } }, 'member'),
      res,
    );

    expect(res.statusCode).toBe(201);
  });

  it('blocks a member from leaving a review verdict', async () => {
    const res = mockRes();
    await addComment(
      mockReq(
        { params: { id: 'prop-1' } as never, body: { body: 'lgtm', kind: 'approve' } },
        'member',
      ),
      res,
    );

    expect(res.statusCode).toBe(403);
    expect(mockInsertComment).not.toHaveBeenCalled();
  });

  it('allows a lead to leave a review verdict', async () => {
    mockGetProposal.mockResolvedValue(makeProposal());
    mockInsertComment.mockResolvedValue({ id: 'c-2' });

    const res = mockRes();
    await addComment(
      mockReq({ params: { id: 'prop-1' } as never, body: { body: 'Sized down, approving', kind: 'approve' } }),
      res,
    );

    expect(res.statusCode).toBe(201);
  });
});
