import request from "supertest";
import { createApp } from "../../app/index";
import { BacktestEngine } from "../../core/backtest/backtestEngine";
import * as repositories from "../../adapters/supabase/repositories";
import * as jobs from "../../adapters/supabase/backtestJobRepository";

jest.mock("../../core/backtest/backtestEngine");
jest.mock("../../adapters/supabase/repositories", () => ({
  ...jest.requireActual("../../adapters/supabase/repositories"),
  findMatchingBacktestResult: jest.fn(),
  backtestResultExists: jest.fn(),
}));
jest.mock("../../adapters/supabase/backtestJobRepository");

const mockEnqueue = jobs.enqueueBacktestJob as jest.Mock;

describe("Backtest HTTP API", () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
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
    const response = await request(app).post("/api/backtests/run").send(payload);

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

      const response = await request(tradingApp).post("/api/backtests/run").send(payload);

      expect(response.status).toBe(202);
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(BacktestEngine.prototype.run).not.toHaveBeenCalled();
    });

    test("the API-only process behaves the same way", async () => {
      const response = await request(createApp()).post("/api/backtests/run").send(payload);
      expect(response.status).toBe(202);
      expect(BacktestEngine.prototype.run).not.toHaveBeenCalled();
    });
  });

  test("POST /api/backtests/run — handles missing fields with 400", async () => {
    const response = await request(app).post("/api/backtests/run").send({ symbol: "SPY" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("required");
  });

  test("GET /api/backtests/:id/stream — 404 for an unknown id", async () => {
    (jobs.getBacktestJob as jest.Mock).mockResolvedValue(null);
    (repositories.backtestResultExists as jest.Mock).mockResolvedValue(false);

    const response = await request(app).get("/api/backtests/unknown/stream");
    expect(response.status).toBe(404);
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
