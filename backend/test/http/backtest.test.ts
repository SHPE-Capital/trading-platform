
import request from "supertest";
import { createApp } from "../../src/app/index";
import { BacktestEngine } from "../../src/core/backtest/backtestEngine";
import * as repositories from "../../src/adapters/supabase/repositories";

jest.mock("../../src/core/backtest/backtestEngine");
jest.mock("../../src/adapters/supabase/repositories");

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

  test("POST /api/backtest/run — handles engine throw (caught by controller)", async () => {
    // Controller catches error in background, but the initial request might fail if validation throws
    // Or if the request body is malformed JSON
    const response = await request(app)
      .post("/api/backtests/run")
      .send("invalid-json")
      .set("Content-Type", "application/json");

    expect(response.status).toBe(400); // Express/Body-parser catch
  });
});
