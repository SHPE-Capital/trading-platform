jest.mock("../../utils/logger", () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("../../adapters/supabase/repositories", () => ({
  getStrategyRunById: jest.fn(),
  getRunsForStrategy: jest.fn(),
  getStrategyById: jest.fn(),
  getFillsForRun: jest.fn(),
  updateStrategyRun: jest.fn(async () => {}),
  backtestConfigKey: jest.fn(() => "key"),
}));
jest.mock("../../adapters/supabase/backtestJobRepository", () => ({
  enqueueBacktestJob: jest.fn(async (input: { id: string }) => ({ jobId: input.id, status: "queued", deduped: false })),
}));
jest.mock("../../adapters/supabase/analyticsRepository", () => ({
  loadRunLedger: jest.fn(),
  getRunEvents: jest.fn(async () => []),
  upsertRunStats: jest.fn(async () => {}),
  capitalBaseOf: jest.fn(() => 5_000),
  runSummariesFor: jest.fn(async () => []),
  filterStrategyRuns: jest.fn((runs: unknown[]) => runs),
}));
jest.mock("../../adapters/supabase/client", () => ({ getSupabaseClient: jest.fn() }));

import type { Request, Response } from "express";
import * as repos from "../../adapters/supabase/repositories";
import * as analytics from "../../adapters/supabase/analyticsRepository";
import { getBrokerAccount, getBrokerHistory, getBrokerDrift } from "../../app/controllers/brokerController";
import { compareRunWithBacktest, getRunPerformance, getStrategyPerformance } from "../../app/controllers/performanceController";
import * as jobs from "../../adapters/supabase/backtestJobRepository";

function mockRes() {
  const res = { json: jest.fn(), status: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response & { json: jest.Mock; status: jest.Mock };
}

const req = (ctx: unknown, params: Record<string, string> = {}, query: Record<string, string> = {}) =>
  ({ app: { locals: { ctx } }, params, query } as unknown as Request);

describe("brokerController", () => {
  it("answers 503 from a process with no broker connection", async () => {
    const res = mockRes();
    await getBrokerAccount(req({}), res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it("serves the broker's account, cached across requests", async () => {
    const getAccount = jest.fn(async () => ({ accountId: "ACCT-cache", equity: 103009.11 }));
    const ctx = { broker: { accountId: "ACCT-cache", getAccount }, executionTarget: "alpaca-paper" };
    const a = mockRes();
    const b = mockRes();
    await getBrokerAccount(req(ctx), a);
    await getBrokerAccount(req(ctx), b);
    expect(getAccount).toHaveBeenCalledTimes(1);
    expect(b.json).toHaveBeenCalledWith({ accountId: "ACCT-cache", equity: 103009.11, executionTarget: "alpaca-paper" });
  });

  it("validates the history period", async () => {
    const res = mockRes();
    await getBrokerHistory(req({ broker: { accountId: "A" } }, {}, { period: "10Y" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns the stored drift rows for the account", async () => {
    const rows = [{ symbol: "SPY", brokerQty: 35, runningQty: 0, stoppedQty: 35, unattributedQty: 0, checkedAt: 1 }];
    const res = mockRes();
    await getBrokerDrift(req({ broker: { accountId: "A" }, ledgerStore: { readDrift: jest.fn(async () => rows) } }), res);
    expect(res.json).toHaveBeenCalledWith({ brokerAccount: "A", rows });
  });
});

describe("performanceController", () => {
  beforeEach(() => jest.clearAllMocks());

  it("404s an unknown run", async () => {
    (repos.getStrategyRunById as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await getRunPerformance(req({}, { runId: "missing-run" }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("builds a run report from the ledger and stores the run's stats", async () => {
    (repos.getStrategyRunById as jest.Mock).mockResolvedValue({ id: "run-x", strategyType: "minute_reversal" });
    (analytics.loadRunLedger as jest.Mock).mockResolvedValue({
      runId: "run-x", name: "MR", strategyType: "minute_reversal", status: "stopped", startedAt: 0, stoppedAt: 120_000,
      capitalBase: 1000, signalOutcomes: { submitted: 2 }, rejectionsByCheck: { ORDER_COOLDOWN: 1 }, snapshots: [],
      orders: [{ id: "o1", symbol: "F", side: "buy", status: "filled", decisionPrice: 10 }, { id: "o2", symbol: "F", side: "sell", status: "filled", decisionPrice: 11 }],
      fills: [
        { orderId: "o1", symbol: "F", side: "buy", qty: 1, price: 10, commission: 0, ts: 1 },
        { orderId: "o2", symbol: "F", side: "sell", qty: 1, price: 11, commission: 0, ts: 60_000 },
      ],
    });
    const res = mockRes();
    await getRunPerformance(req({}, { runId: "run-x" }), res);
    const report = res.json.mock.calls[0][0];
    expect(report.metrics).toMatchObject({ totalReturn: 1, totalTrades: 1, winRate: 1 });
    expect(report.funnel).toMatchObject({ signals: 2, submitted: 2, orders: 2, fills: 2 });
    expect(report.rejectionsByCheck).toEqual([{ check: "ORDER_COOLDOWN", count: 1 }]);
    expect(report.events).toEqual([]);
    expect(analytics.upsertRunStats).toHaveBeenCalled();
  });

  it("404s an unknown strategy", async () => {
    (repos.getStrategyById as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await getStrategyPerformance(req({}, { strategyId: "nope" }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("compareRunWithBacktest", () => {
  beforeEach(() => jest.clearAllMocks());
  const pairsRun = {
    id: "run-p", strategyId: "strat-p", strategyType: "pairs_trading", name: "Pairs: SPY/QQQ", status: "stopped",
    startedAt: Date.parse("2026-10-01T13:30:00Z"), stoppedAt: Date.parse("2026-10-03T20:00:00Z"),
    config: { id: "cfg", symbols: ["SPY", "QQQ"] }, versionId: "ver-2", meta: {},
  };
  const postReq = (runId: string, body: unknown = {}) =>
    ({ app: { locals: { ctx: {} } }, params: { runId }, body, user: { id: "u1" } } as unknown as Request);

  it("queues a backtest of the run's exact window and config, linked to the run", async () => {
    (repos.getStrategyRunById as jest.Mock).mockResolvedValue(pairsRun);
    const res = mockRes();
    await compareRunWithBacktest(postReq("run-p"), res);
    expect(res.status).toHaveBeenCalledWith(202);
    const { config } = (jobs.enqueueBacktestJob as jest.Mock).mock.calls[0][0];
    expect(config).toMatchObject({
      startDate: "2026-10-01T13:30:00.000Z", endDate: "2026-10-03T20:00:00.000Z", initialCapital: 5_000,
      strategyId: "strat-p", strategyVersionId: "ver-2", sourceRunId: "run-p",
      strategyConfig: { type: "pairs_trading", symbols: ["SPY", "QQQ"] },
    });
    expect(repos.updateStrategyRun).toHaveBeenCalledWith("run-p", { meta: { compareBacktestId: config.id } });
  });

  it("reuses the previous comparison unless forced", async () => {
    (repos.getStrategyRunById as jest.Mock).mockResolvedValue({ ...pairsRun, meta: { compareBacktestId: "bt-1" } });
    const res = mockRes();
    await compareRunWithBacktest(postReq("run-p"), res);
    expect(res.json).toHaveBeenCalledWith({ backtestId: "bt-1", reused: true });
    expect(jobs.enqueueBacktestJob).not.toHaveBeenCalled();
  });

  it("says plainly when the strategy type cannot be backtested", async () => {
    (repos.getStrategyRunById as jest.Mock).mockResolvedValue({ ...pairsRun, strategyType: "minute_reversal" });
    const res = mockRes();
    await compareRunWithBacktest(postReq("run-p"), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/not supported for minute_reversal/);
  });
});
