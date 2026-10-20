import request from "supertest";
import { createApp } from "../../app/index";
import { env } from "../../config/env";
import { clearVerifiedCallers } from "../../app/middleware/requireAuth";
import { BacktestEngine } from "../../core/backtest/backtestEngine";
import * as repositories from "../../adapters/supabase/repositories";
import * as jobs from "../../adapters/supabase/backtestJobRepository";
import * as review from "../../adapters/supabase/reviewRepositories";
import { getSupabaseClient } from "../../adapters/supabase/client";

jest.mock("../../core/backtest/backtestEngine");
jest.mock("../../adapters/supabase/repositories", () => ({
  ...jest.requireActual("../../adapters/supabase/repositories"),
  findMatchingBacktestResult: jest.fn(),
  backtestResultExists: jest.fn(),
}));
jest.mock("../../adapters/supabase/backtestJobRepository");
jest.mock("../../adapters/supabase/reviewRepositories");
jest.mock("../../adapters/supabase/client");

const mockGetUser = jest.fn();
(getSupabaseClient as jest.Mock).mockReturnValue({ auth: { getUser: mockGetUser } });

const mockEnqueue = jobs.enqueueBacktestJob as jest.Mock;

describe("Backtest HTTP API", () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    clearVerifiedCallers();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    (review.getAppUserById as jest.Mock).mockResolvedValue({
      id: "user-1", email: "member@shpe.test", displayName: "Member", role: "member", membershipStatus: "active",
    });
    (repositories.findMatchingBacktestResult as jest.Mock).mockResolvedValue(null);
    (jobs.findReusableJob as jest.Mock).mockResolvedValue(null);
    mockEnqueue.mockImplementation(async ({ id }: { id: string }) => ({ jobId: id, status: "queued", deduped: false }));
  });

  const payload = {
    name: "Test Run",
    startDate: "2023-01-01",
    endDate: "2023-01-07",
    initialCapital: 100000,
    strategyConfig: { type: "pairs_trading", leg1Symbol: "SPY", leg2Symbol: "QQQ", symbols: ["SPY", "QQQ"] },
  };

  test("POST /api/backtests/run — queues a job and returns 202", async () => {
    const response = await request(app).post("/api/backtests/run").set("Authorization", "Bearer valid").send(payload);

    expect(response.status).toBe(202);
    expect(response.body.backtestId).toBeDefined();
    expect(response.body.message).toContain("Backtest queued");
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Process isolation. Trading runtimes mount this same API. Before the queue,
  // that meant a UI backtest could run the engine inside the live process; now
  // every process only enqueues, and the engine runs in a worker.
  // ---------------------------------------------------------------------------
  describe("process isolation", () => {
    test("a trading process enqueues instead of running the engine in-process", async () => {
      const tradingApp = createApp({ orchestrator: {} as never, executionMode: "paper" });

      const response = await request(tradingApp).post("/api/backtests/run").set("Authorization", "Bearer valid").send(payload);

      expect(response.status).toBe(202);
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(BacktestEngine.prototype.run).not.toHaveBeenCalled();
    });

    test("the API-only process behaves the same way", async () => {
      const response = await request(createApp()).post("/api/backtests/run").set("Authorization", "Bearer valid").send(payload);
      expect(response.status).toBe(202);
      expect(BacktestEngine.prototype.run).not.toHaveBeenCalled();
    });
  });

  describe("submission limits", () => {
    const run = (body: object) =>
      request(app).post("/api/backtests/run").set("Authorization", "Bearer valid").send({ ...payload, ...body });
    const saved = { maxDays: env.backtestMaxDays, quotes: env.backtestAllowQuoteFills };
    afterEach(() => {
      env.backtestMaxDays = saved.maxDays;
      env.backtestAllowQuoteFills = saved.quotes;
    });

    test("rejects dates that do not parse or run backwards", async () => {
      expect((await run({ startDate: "not-a-date" })).status).toBe(400);
      const backwards = await run({ startDate: "2024-03-01", endDate: "2024-01-01" });
      expect(backwards.status).toBe(400);
      expect(backwards.body.error).toContain("after startDate");
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    test("rejects a range longer than BACKTEST_MAX_DAYS", async () => {
      env.backtestMaxDays = 30;
      const tooLong = await run({ startDate: "2024-01-01", endDate: "2024-03-01" });
      expect(tooLong.status).toBe(400);
      expect(tooLong.body.error).toContain("at most 30 days");
      expect((await run({ startDate: "2024-01-01", endDate: "2024-01-20" })).status).toBe(202);
    });

    test("rejects quote fills when the server disallows them", async () => {
      env.backtestAllowQuoteFills = false;
      const quote = await run({ execution: { model: "quote" } });
      expect(quote.status).toBe(400);
      expect(quote.body.error).toContain("Quote-fill");
      expect((await run({})).status).toBe(202);
    });
  });

  test("POST /api/backtests/run — handles missing fields with 400", async () => {
    const response = await request(app).post("/api/backtests/run").set("Authorization", "Bearer valid").send({ symbol: "SPY" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("required");
  });

  test("GET /health — returns 200 ok", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
  });

  test("ANY /invalid — returns 404", async () => {
    const response = await request(app).get("/api/invalid");
    expect(response.status).toBe(404);
  });

  test("POST /api/backtests/run — handles malformed JSON with 400", async () => {
    const response = await request(app)
      .post("/api/backtests/run")
      .send("invalid-json")
      .set("Content-Type", "application/json");

    expect(response.status).toBe(400);
  });
});
