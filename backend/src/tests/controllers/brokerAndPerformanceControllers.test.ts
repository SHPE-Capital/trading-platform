jest.mock("../../utils/logger", () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("../../adapters/supabase/repositories", () => ({
  getStrategyRunById: jest.fn(),
  getRunsForStrategy: jest.fn(),
  getStrategyById: jest.fn(),
  getFillsForRun: jest.fn(),
}));
jest.mock("../../adapters/supabase/analyticsRepository", () => ({
  loadRunLedger: jest.fn(),
  getRunEvents: jest.fn(async () => []),
  upsertRunStats: jest.fn(async () => {}),
  runSummariesFor: jest.fn(async () => []),
  filterStrategyRuns: jest.fn((runs: unknown[]) => runs),
}));
jest.mock("../../adapters/supabase/client", () => ({ getSupabaseClient: jest.fn() }));

import type { Request, Response } from "express";
import * as repos from "../../adapters/supabase/repositories";
import * as analytics from "../../adapters/supabase/analyticsRepository";
import { getBrokerAccount, getBrokerHistory, getBrokerDrift } from "../../app/controllers/brokerController";
import { getRunPerformance, getStrategyPerformance } from "../../app/controllers/performanceController";

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
