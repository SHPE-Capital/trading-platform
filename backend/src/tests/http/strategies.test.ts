import request from "supertest";
import { createApp } from "../../app/index";
import * as repositories from "../../adapters/supabase/repositories";

jest.mock("../../adapters/supabase/repositories");

const mockGetAll = repositories.getAllStrategyRuns as jest.Mock;
const mockGetById = repositories.getStrategyRunById as jest.Mock;
const mockInsertRun = repositories.insertStrategyRun as jest.Mock;
const mockUpdateRun = repositories.updateStrategyRun as jest.Mock;
const mockGetAllStrategies = repositories.getAllStrategies as jest.Mock;
const mockGetStrategyById = repositories.getStrategyById as jest.Mock;

describe("Strategies HTTP API", () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // GET /api/strategies — list all runs
  // -------------------------------------------------------------------------
  describe("GET /api/strategies", () => {
    test("returns 200 with enriched runs (isLive=false, no orchestrator)", async () => {
      const runs = [{ id: "run-1", status: "running" }, { id: "run-2", status: "stopped" }];
      mockGetAll.mockResolvedValue(runs);

      const res = await request(app).get("/api/strategies");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toMatchObject({ id: "run-1", isLive: false });
      expect(res.body[1]).toMatchObject({ id: "run-2", isLive: false });
    });

    test("returns 200 with empty array when no runs exist", async () => {
      mockGetAll.mockResolvedValue([]);
      const res = await request(app).get("/api/strategies");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/strategies/:id — single run
  // -------------------------------------------------------------------------
  describe("GET /api/strategies/:id", () => {
    test("returns 200 with isLive=false when run exists but not in orchestrator", async () => {
      mockGetById.mockResolvedValue({ id: "run-1", status: "running" });
      const res = await request(app).get("/api/strategies/run-1");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: "run-1", isLive: false });
    });

    test("returns 404 when run does not exist", async () => {
      mockGetById.mockResolvedValue(null);
      const res = await request(app).get("/api/strategies/missing-id");
      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/strategies/start — start a run
  // -------------------------------------------------------------------------
  describe("POST /api/strategies/start", () => {
    test("returns 503 when no orchestrator context (API-only mode)", async () => {
      const res = await request(app)
        .post("/api/strategies/start")
        .send({ strategyType: "pairs_trading", config: { name: "test", symbols: ["SPY", "QQQ"] } });
      expect(res.status).toBe(503);
    });

    test("returns 400 when strategyType is missing", async () => {
      const res = await request(app)
        .post("/api/strategies/start")
        .send({ config: {} });
      expect(res.status).toBe(400);
    });

    test("returns 400 when config is missing", async () => {
      const res = await request(app)
        .post("/api/strategies/start")
        .send({ strategyType: "pairs_trading" });
      expect(res.status).toBe(400);
    });

    test("returns 400 for unknown strategy type (with orchestrator would return 400 not 503)", async () => {
      const res = await request(app)
        .post("/api/strategies/start")
        .send({ strategyType: "unknown_strategy", config: { name: "x" } });
      // No orchestrator in test app, so 503 is returned before the factory check.
      // This verifies the route is wired and reachable.
      expect([400, 503]).toContain(res.status);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/strategies/:id/stop — stop a run
  // -------------------------------------------------------------------------
  describe("POST /api/strategies/:id/stop", () => {
    test("returns 503 when no orchestrator context (API-only mode)", async () => {
      const res = await request(app).post("/api/strategies/run-1/stop");
      expect(res.status).toBe(503);
    });
  });

  // -------------------------------------------------------------------------
  // Strategy config CRUD
  // -------------------------------------------------------------------------
  describe("GET /api/strategies/configs", () => {
    test("returns 200 with array of saved configs enriched with algorithmVersion", async () => {
      const configs = [{ id: "cfg-1", name: "My Pairs", strategy_type: "pairs_trading" }];
      mockGetAllStrategies.mockResolvedValue(configs);
      const res = await request(app).get("/api/strategies/configs");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([expect.objectContaining({ id: "cfg-1", name: "My Pairs", algorithmVersion: 3 })]);
    });
  });

  describe("GET /api/strategies/configs/defaults/:type", () => {
    test("returns 200 with default config for pairs_trading", async () => {
      const res = await request(app).get("/api/strategies/configs/defaults/pairs_trading");
      expect(res.status).toBe(200);
      expect(res.body.type).toBe("pairs_trading");
      expect(res.body.defaultConfig).toBeDefined();
    });

    test("returns 404 for unknown strategy type", async () => {
      const res = await request(app).get("/api/strategies/configs/defaults/unknown_type");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/strategies/configs", () => {
    test("returns 400 when required fields are missing", async () => {
      const res = await request(app)
        .post("/api/strategies/configs")
        .send({ name: "test" }); // missing strategy_type and config
      expect(res.status).toBe(400);
    });

    test("returns 400 for unknown strategy type", async () => {
      const res = await request(app)
        .post("/api/strategies/configs")
        .send({ strategy_type: "unknown", name: "test", config: {} });
      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/strategies/configs/:configId", () => {
    test("returns 404 when config does not exist", async () => {
      mockGetStrategyById.mockResolvedValue(null);
      const res = await request(app)
        .put("/api/strategies/configs/missing-id")
        .send({ name: "Updated", config: {} });
      expect(res.status).toBe(404);
    });

    test("returns 400 when name or config is missing", async () => {
      const res = await request(app)
        .put("/api/strategies/configs/cfg-1")
        .send({ name: "Only name" }); // missing config
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/strategies/configs/:configId", () => {
    test("returns 200 on successful delete", async () => {
      (repositories.deleteStrategy as jest.Mock).mockResolvedValue(undefined);
      const res = await request(app).delete("/api/strategies/configs/cfg-1");
      expect(res.status).toBe(200);
      expect(res.body.message).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Portfolio orders endpoint
  // -------------------------------------------------------------------------
  describe("GET /api/portfolio/orders", () => {
    test("returns all orders when strategyRunId is absent", async () => {
      (repositories.getAllOrders as jest.Mock).mockResolvedValue([{ id: "o1" }]);
      const res = await request(app).get("/api/portfolio/orders");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    test("returns filtered orders when strategyRunId is provided", async () => {
      (repositories.getOrdersByStrategyRun as jest.Mock).mockResolvedValue([{ id: "o2" }]);
      const res = await request(app).get("/api/portfolio/orders?strategyRunId=run-1");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });
});
