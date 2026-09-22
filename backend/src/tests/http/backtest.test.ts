
import request from "supertest";
import { createApp } from "../../app/index";
import { BacktestEngine } from "../../core/backtest/backtestEngine";
import * as repositories from "../../adapters/supabase/repositories";

jest.mock("../../core/backtest/backtestEngine");
jest.mock("../../adapters/supabase/repositories");

describe("Backtest HTTP API", () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("POST /api/backtest/run — starts a backtest and returns 200", async () => {
    const mockResult = {
        id: "test-run-id",
        status: "completed",
        metrics: { totalReturnPct: 0.05 },
        final_portfolio: { equity: 105000 },
        orders: [],
        fills: [],
    };

    (BacktestEngine.prototype.run as jest.Mock).mockResolvedValue(mockResult);
    (repositories.insertBacktestResult as jest.Mock).mockResolvedValue(undefined);
    (repositories.insertBacktestOrders as jest.Mock).mockResolvedValue(undefined);
    (repositories.insertBacktestFills as jest.Mock).mockResolvedValue(undefined);

    const payload = {
      name: "Test Run",
      symbol: "SPY",
      startDate: "2023-01-01",
      endDate: "2023-01-07",
      initialCapital: 100000,
      strategyConfig: {
        type: "pairs_trading",
        leg1Symbol: "SPY",
        leg2Symbol: "QQQ",
      }
    };

    const response = await request(app)
      .post("/api/backtests/run")
      .send(payload);

    expect(response.status).toBe(202);
    expect(response.body.backtestId).toBeDefined();
    expect(response.body.message).toContain("Backtest queued");
  });

  // ---------------------------------------------------------------------------
  // Process isolation: trading runtimes mount this same API, so the route must
  // refuse to run an engine in a process that also holds the live orchestrator.
  // ---------------------------------------------------------------------------
  describe("process isolation guard", () => {
    const validPayload = {
      name: "Guarded Run",
      startDate: "2023-01-01",
      endDate: "2023-01-07",
      initialCapital: 100000,
      strategyConfig: { type: "pairs_trading", leg1Symbol: "XOM", leg2Symbol: "CVX" },
    };

    test("returns 409 and never starts the engine on a trading process", async () => {
      const tradingApp = createApp({
        orchestrator: {} as never,
        executionMode: "paper",
      });

      const response = await request(tradingApp)
        .post("/api/backtests/run")
        .send(validPayload);

      expect(response.status).toBe(409);
      expect(response.body.error).toContain("cannot run on a trading process");
      expect(response.body.detail).toContain("paper");
      expect(BacktestEngine.prototype.run).not.toHaveBeenCalled();
    });

    test("still accepts the same request on the API-only process", async () => {
      (BacktestEngine.prototype.run as jest.Mock).mockResolvedValue({
        id: "api-only-run",
        status: "completed",
        metrics: {},
        final_portfolio: {},
        orders: [],
        fills: [],
      });

      const response = await request(createApp())
        .post("/api/backtests/run")
        .send(validPayload);

      expect(response.status).toBe(202);
    });
  });

  test("POST /api/backtests/run — handles missing fields with 400", async () => {
    const response = await request(app)
      .post("/api/backtests/run")
      .send({
        symbol: "SPY",
        // missing strategyConfig, startDate, endDate
      });

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

  test("POST /api/backtest/run — handles malformed JSON with 400", async () => {
    const response = await request(app)
      .post("/api/backtests/run")
      .send("invalid-json")
      .set("Content-Type", "application/json");

    expect(response.status).toBe(400);
  });
});
