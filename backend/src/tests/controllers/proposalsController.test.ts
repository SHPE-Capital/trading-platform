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
    runtimeOrigin: 'test',
    buildSha: 'test-sha',
    buildDirty: false,
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
  listProposalsHandler,
  selectPromotionEvidence,
} from '../../app/controllers/proposalsController';
import { PairsStrategy } from '../../strategies/pairs/pairsStrategy';
import type { StrategyProposal, StrategyVersion } from '../../types/review';

const mockSettle = review.settleProposal as jest.Mock;
const mockReopen = review.reopenProposal as jest.Mock;
const mockGetProposal = review.getProposalById as jest.Mock;
const mockGetVersion = review.getStrategyVersionById as jest.Mock;
const mockGetBacktests = review.getBacktestsForVersion as jest.Mock;
const mockGetOpen = review.getOpenProposalForStrategy as jest.Mock;
const mockGetLatest = review.getLatestStrategyVersion as jest.Mock;
const mockInsertProposal = review.insertProposal as jest.Mock;
const mockInsertVersion = review.insertStrategyVersion as jest.Mock;
const mockUpdateHead = review.updateProposalHead as jest.Mock;
const mockInsertComment = review.insertComment as jest.Mock;
const mockListPending = review.listPendingApprovals as jest.Mock;
const mockListSummaries = review.listProposalSummaries as jest.Mock;
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

/** The runtime's lease-holding registry, as the controller sees it. */
const liveRuns = {
  owner: 'paper:test-host:1:abc',
  prepare: jest.fn(async () => {}),
  activate: jest.fn(),
  deactivate: jest.fn(async () => {}),
  forget: jest.fn(),
  leaseFields: jest.fn(() => ({ leaseOwner: 'paper:test-host:1:abc', leaseExpiresAt: 1 })),
};

function mockReq(overrides: Partial<Request> = {}, role: 'member' | 'lead' = 'lead'): Request {
  return {
    body: {},
    params: {},
    query: {},
    user: { id: 'user-lead', email: 'lead@shpe.test', role, displayName: 'Lead', membershipStatus: 'active' },
    app: { locals: { ctx: { orchestrator, liveRuns, executionMode: 'live' } } },
    ...overrides,
  } as unknown as Request;
}

/** An approve request that names the reviewed head, as the review page sends it. */
function approveReq(overrides: Partial<Request> = {}, role: 'member' | 'lead' = 'lead'): Request {
  return mockReq({ ...overrides, body: { expectedHeadVersionId: 'ver-1', ...(overrides.body ?? {}) } }, role);
}

/** A saved backtest that satisfies every promotion-evidence rule under the mocked env. */
function qualifyingBacktest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'bt-1',
    status: 'completed',
    strategy_version: PairsStrategy.VERSION,
    runtime_origin: 'test',
    build_sha: 'test-sha',
    build_dirty: false,
    ...overrides,
  };
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
  mockGetBacktests.mockResolvedValue([qualifyingBacktest()]);
  orchestrator.registerStrategy.mockReset();
  orchestrator.deregisterStrategy.mockReset();
});

// ---------------------------------------------------------------------------
// Approve — the only path that puts a strategy live
// ---------------------------------------------------------------------------
describe('approveProposal', () => {
  it('settles the proposal, writes one leased run, then starts trading it', async () => {
    mockGetProposal.mockResolvedValue(makeProposal());
    mockGetVersion.mockResolvedValue(makeVersion());
    mockSettle.mockResolvedValue(makeProposal({ status: 'approved', approvedBy: 'user-lead' }));
    mockInsertRun.mockResolvedValue(undefined);

    const res = mockRes();
    await approveProposal(approveReq({ params: { id: 'prop-1' } as never }), res);

    expect(res.statusCode).toBe(201);
    expect(mockInsertRun).toHaveBeenCalledTimes(1);
    expect(liveRuns.activate).toHaveBeenCalledTimes(1);
    // Warmed from history before trading, persisted before trading.
    expect(liveRuns.prepare.mock.invocationCallOrder[0]).toBeLessThan(mockInsertRun.mock.invocationCallOrder[0]);
    expect(mockInsertRun.mock.invocationCallOrder[0]).toBeLessThan(liveRuns.activate.mock.invocationCallOrder[0]);

    // The run must cite the exact version and the proposal that authorised it.
    const run = mockInsertRun.mock.calls[0][0];
    expect(run.versionId).toBe('ver-1');
    expect(run.proposalId).toBe('prop-1');
    // Accountability stays with the author, not the approving lead.
    expect(run.ownerId).toBe('user-author');
    expect(run.status).toBe('running');
    // Inserted already leased to this runner, so no other runner can adopt it.
    expect(run.leaseOwner).toBe(liveRuns.owner);
  });

  it('gives the strategy the strategies row as its identity', async () => {
    mockGetProposal.mockResolvedValue(makeProposal());
    // Versions saved from the form carry no id inside config.
    mockGetVersion.mockResolvedValue(makeVersion({
      config: { type: 'pairs_trading', name: 'Pairs: XOM/CVX', symbols: ['XOM', 'CVX'] } as never,
    }));
    mockSettle.mockResolvedValue(makeProposal({ status: 'approved' }));
    mockInsertRun.mockResolvedValue(undefined);

    await approveProposal(approveReq({ params: { id: 'prop-1' } as never }), mockRes());

    // Otherwise strategy.id is undefined and every approved strategy shares one risk budget.
    expect(mockInsertRun.mock.calls[0][0].config.id).toBe('strat-1');
    const [, strategy] = liveRuns.activate.mock.calls[0] as unknown as [string, { id: string }];
    expect(strategy.id).toBe('strat-1');
  });

  it('refuses to approve a strategy that is already live, before settling anything', async () => {
    mockGetProposal.mockResolvedValue(makeProposal());
    mockGetVersion.mockResolvedValue(makeVersion());
    orchestrator.hasStrategyWithConfigId.mockReturnValueOnce(true);

    const res = mockRes();
    await approveProposal(approveReq({ params: { id: 'prop-1' } as never }), res);

    expect(res.statusCode).toBe(409);
    expect(mockSettle).not.toHaveBeenCalled();
    expect(mockInsertRun).not.toHaveBeenCalled();
  });

  it('keeps the run live when only the approval note fails to post', async () => {
    mockGetProposal.mockResolvedValue(makeProposal());
    mockGetVersion.mockResolvedValue(makeVersion());
    mockSettle.mockResolvedValue(makeProposal({ status: 'approved' }));
    mockInsertRun.mockResolvedValue(undefined);
    mockInsertComment.mockRejectedValueOnce(new Error('comments down'));

    const res = mockRes();
    await approveProposal(approveReq({ params: { id: 'prop-1' } as never, body: { note: 'lgtm' } }), res);

    expect(res.statusCode).toBe(201);
    expect(mockReopen).not.toHaveBeenCalled();
    expect(liveRuns.forget).not.toHaveBeenCalled();
  });

  it('applies the approver capital override to the run config', async () => {
    mockGetProposal.mockResolvedValue(makeProposal());
    mockGetVersion.mockResolvedValue(makeVersion());
    mockSettle.mockResolvedValue(makeProposal({ status: 'approved' }));
    mockInsertRun.mockResolvedValue(undefined);

    const res = mockRes();
    await approveProposal(
      approveReq({ params: { id: 'prop-1' } as never, body: { approvedCapitalPct: 0.1 } }),
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

    await approveProposal(approveReq({ params: { id: 'prop-1' } as never }), mockRes());

    expect(mockInsertRun.mock.calls[0][0].config.riskBudget.maxCapitalPct).toBe(0.4);
  });

  it('returns 409 when another lead settled it first', async () => {
    mockGetProposal.mockResolvedValue(makeProposal());
    mockGetVersion.mockResolvedValue(makeVersion());
    // The guarded UPDATE matched zero rows — someone else won the race.
    mockSettle.mockResolvedValue(null);

    const res = mockRes();
    await approveProposal(approveReq({ params: { id: 'prop-1' } as never }), res);

    expect(res.statusCode).toBe(409);
    expect(liveRuns.activate).not.toHaveBeenCalled();
    expect(mockInsertRun).not.toHaveBeenCalled();
  });

  it('reopens the proposal and never starts trading when the run fails to persist', async () => {
    mockGetProposal.mockResolvedValue(makeProposal());
    mockGetVersion.mockResolvedValue(makeVersion());
    mockSettle.mockResolvedValue(makeProposal({ status: 'approved' }));
    mockInsertRun.mockRejectedValue(new Error('db down'));

    const res = mockRes();
    await approveProposal(approveReq({ params: { id: 'prop-1' } as never }), res);

    expect(res.statusCode).toBe(500);
    // Neither the engine nor the queue may be left claiming something that isn't true.
    expect(liveRuns.activate).not.toHaveBeenCalled();
    expect(mockReopen).toHaveBeenCalledWith('prop-1');
  });

  it('rejects a capital override outside 0–1 before touching anything', async () => {
    const res = mockRes();
    await approveProposal(
      approveReq({ params: { id: 'prop-1' } as never, body: { approvedCapitalPct: 1.5 } }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('returns 503 on a process with no orchestrator', async () => {
    const res = mockRes();
    const req = approveReq({ params: { id: 'prop-1' } as never });
    (req.app.locals as { ctx: Record<string, unknown> }).ctx = {};

    await approveProposal(req, res);

    expect(res.statusCode).toBe(503);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('refuses a proposal that is not open', async () => {
    mockGetProposal.mockResolvedValue(makeProposal({ status: 'rejected' }));

    const res = mockRes();
    await approveProposal(approveReq({ params: { id: 'prop-1' } as never }), res);

    expect(res.statusCode).toBe(409);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('requires the reviewed head version in the request', async () => {
    const res = mockRes();
    await approveProposal(mockReq({ params: { id: 'prop-1' } as never, body: {} }), res);

    expect(res.statusCode).toBe(400);
    expect(mockGetProposal).not.toHaveBeenCalled();
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('refuses when the head moved past the version the lead reviewed', async () => {
    // The author pushed ver-2 after the lead loaded the page showing ver-1.
    mockGetProposal.mockResolvedValue(makeProposal({ headVersionId: 'ver-2' }));

    const res = mockRes();
    await approveProposal(approveReq({ params: { id: 'prop-1' } as never }), res);

    expect(res.statusCode).toBe(409);
    expect(res.payload).toEqual(expect.objectContaining({ headVersionId: 'ver-2' }));
    expect(mockSettle).not.toHaveBeenCalled();
    expect(orchestrator.registerStrategy).not.toHaveBeenCalled();
  });

  it('refuses when no saved backtest qualifies, and says why each was rejected', async () => {
    mockGetProposal.mockResolvedValue(makeProposal());
    mockGetVersion.mockResolvedValue(makeVersion());
    mockGetBacktests.mockResolvedValue([
      qualifyingBacktest({ id: 'bt-old-algo', strategy_version: PairsStrategy.VERSION - 1 }),
      qualifyingBacktest({ id: 'bt-laptop', runtime_origin: 'local' }),
    ]);

    const res = mockRes();
    await approveProposal(approveReq({ params: { id: 'prop-1' } as never }), res);

    expect(res.statusCode).toBe(409);
    const payload = res.payload as { rejectedBacktests: { id: string; reason: string }[] };
    expect(payload.rejectedBacktests.map((r) => r.id)).toEqual(['bt-old-algo', 'bt-laptop']);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('settles with the reviewed head as the guard', async () => {
    mockGetProposal.mockResolvedValue(makeProposal());
    mockGetVersion.mockResolvedValue(makeVersion());
    mockSettle.mockResolvedValue(makeProposal({ status: 'approved', approvedBy: 'user-lead' }));
    mockInsertRun.mockResolvedValue(undefined);

    await approveProposal(approveReq({ params: { id: 'prop-1' } as never }), mockRes());

    expect(mockSettle).toHaveBeenCalledWith(
      'prop-1',
      expect.objectContaining({ status: 'approved', expectedHeadVersionId: 'ver-1' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Promotion evidence rules
// ---------------------------------------------------------------------------
describe('selectPromotionEvidence', () => {
  const clean = { origin: 'prod', dirty: false };
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'bt', status: 'completed', strategy_version: 4, runtime_origin: 'prod', build_sha: 'abc', build_dirty: false,
    ...overrides,
  });

  it('accepts a completed, current-algorithm, same-origin, clean-build backtest', () => {
    const { qualifying, rejected } = selectPromotionEvidence([row()], 4, clean);
    expect(qualifying).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it.each([
    ['an incomplete run', row({ status: 'failed' }), /not completed/],
    ['evidence for an older algorithm', row({ strategy_version: 3 }), /v3.*v4 is deployed/],
    ['a run from another environment', row({ runtime_origin: 'local' }), /local environment/],
    ['a run from an uncommitted build', row({ build_dirty: true, build_sha: 'local' }), /uncommitted build/],
    ['a legacy row with no provenance', row({ runtime_origin: 'legacy', build_dirty: undefined }), /legacy environment/],
  ])('rejects %s', (_label, candidate, reason) => {
    const { qualifying, rejected } = selectPromotionEvidence([candidate], 4, clean);
    expect(qualifying).toHaveLength(0);
    expect(rejected[0].reason).toMatch(reason);
  });

  it('lets a dirty local runtime approve dirty local evidence so the workflow stays testable', () => {
    const local = { origin: 'local', dirty: true };
    const { qualifying } = selectPromotionEvidence([row({ runtime_origin: 'local', build_dirty: true })], 4, local);
    expect(qualifying).toHaveLength(1);
  });

  it('skips the algorithm check for a strategy type with no declared version', () => {
    const { qualifying } = selectPromotionEvidence([row({ strategy_version: null })], undefined, clean);
    expect(qualifying).toHaveLength(1);
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

// ---------------------------------------------------------------------------
// Listing — the approvals page's "in progress" vs "all" toggle
// ---------------------------------------------------------------------------
describe('listProposalsHandler', () => {
  it('defaults to the enriched open queue when status is omitted', async () => {
    mockListPending.mockResolvedValue([{ proposalId: 'p1', changesRequested: false }]);

    const res = mockRes();
    await listProposalsHandler(mockReq({ query: {} }), res);

    expect(mockListPending).toHaveBeenCalled();
    expect(mockListSummaries).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual([{ proposalId: 'p1', changesRequested: false }]);
  });

  it('status=all returns every proposal via the unfiltered summaries view', async () => {
    mockListSummaries.mockResolvedValue([{ proposalId: 'p1' }, { proposalId: 'p2' }]);

    const res = mockRes();
    await listProposalsHandler(mockReq({ query: { status: 'all' } as never }), res);

    expect(mockListSummaries).toHaveBeenCalledWith(undefined);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toHaveLength(2);
  });

  it('status=rejected filters the summaries view by that status', async () => {
    mockListSummaries.mockResolvedValue([{ proposalId: 'p3', status: 'rejected' }]);

    const res = mockRes();
    await listProposalsHandler(mockReq({ query: { status: 'rejected' } as never }), res);

    expect(mockListSummaries).toHaveBeenCalledWith('rejected');
    expect(res.statusCode).toBe(200);
  });

  it('rejects an unknown status value', async () => {
    const res = mockRes();
    await listProposalsHandler(mockReq({ query: { status: 'bogus' } as never }), res);

    expect(res.statusCode).toBe(400);
    expect(mockListSummaries).not.toHaveBeenCalled();
    expect(mockListPending).not.toHaveBeenCalled();
  });
});
