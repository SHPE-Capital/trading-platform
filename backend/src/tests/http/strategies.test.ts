import request from "supertest";
import { createApp } from "../../app/index";
import * as repositories from "../../adapters/supabase/repositories";
import * as review from "../../adapters/supabase/reviewRepositories";
import { getSupabaseClient } from "../../adapters/supabase/client";
import { PairsStrategy } from "../../strategies/pairs/pairsStrategy";
import { strategyDefinition } from "../../config/strategyPolicy";
import { STRATEGY_DEFINITIONS, STRATEGY_FACTORY } from "../../config/strategyDefaults";
import { BeginnerReversalStrategy } from "../../strategies/beginnerReversal/beginnerReversalStrategy";
import type { AppContext } from "../../app/context";

jest.mock("../../adapters/supabase/repositories");
jest.mock("../../adapters/supabase/reviewRepositories");
jest.mock("../../adapters/supabase/client");
jest.mock("../../adapters/supabase/analyticsRepository", () => ({
  ...jest.requireActual("../../adapters/supabase/analyticsRepository"),
  insertRunEvent: jest.fn().mockResolvedValue(undefined),
}));

const mockGetAll = repositories.getAllStrategyRuns as jest.Mock;
const mockGetById = repositories.getStrategyRunById as jest.Mock;
const mockGetAllStrategies = repositories.getAllStrategies as jest.Mock;
const mockGetStrategyById = repositories.getStrategyById as jest.Mock;
const mockInsertStrategyVersion = review.insertStrategyVersion as jest.Mock;
const mockGetAppUser = review.getAppUserById as jest.Mock;

const mockGetUser = jest.fn();
(getSupabaseClient as jest.Mock).mockReturnValue({ auth: { getUser: mockGetUser } });

/** Signs the next request in as a club member. Config CRUD needs no special role. */
function signedInAs(id = "user-1") {
  mockGetUser.mockResolvedValue({ data: { user: { id } }, error: null });
  mockGetAppUser.mockResolvedValue({
    id, email: "member@shpe.test", displayName: "Member", role: "member", membershipStatus: "active",
  });
}

describe("Strategies HTTP API", () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // GET /api/strategies — list all runs
  // -------------------------------------------------------------------------
  describe("GET /api/strategies", () => {
    beforeEach(() => signedInAs());

    test("returns 200 with enriched runs (isLive=false, no orchestrator)", async () => {
      const runs = [{ id: "run-1", status: "running" }, { id: "run-2", status: "stopped" }];
      mockGetAll.mockResolvedValue(runs);

      const res = await request(app).get("/api/strategies").set("Authorization", "Bearer valid");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toMatchObject({ id: "run-1", isLive: false });
      expect(res.body[1]).toMatchObject({ id: "run-2", isLive: false });
    });

    test("returns 200 with empty array when no runs exist", async () => {
      mockGetAll.mockResolvedValue([]);
      const res = await request(app).get("/api/strategies").set("Authorization", "Bearer valid");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/strategies/:id — single run
  // -------------------------------------------------------------------------
  describe("GET /api/strategies/:id", () => {
    beforeEach(() => signedInAs());

    test("returns 200 with isLive=false when run exists but not in orchestrator", async () => {
      mockGetById.mockResolvedValue({ id: "run-1", status: "running" });
      const res = await request(app).get("/api/strategies/run-1").set("Authorization", "Bearer valid");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: "run-1", isLive: false });
    });

    test("returns 404 when run does not exist", async () => {
      mockGetById.mockResolvedValue(null);
      const res = await request(app).get("/api/strategies/missing-id").set("Authorization", "Bearer valid");
      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/strategies/start — start a run
  // -------------------------------------------------------------------------
  describe("POST /api/strategies/start", () => {
    test("starts a saved beginner version on the paper runner using the catalog factory", async () => {
      signedInAs();
      mockGetStrategyById.mockResolvedValue({
        id: "cfg-beginner", owner_id: "user-1", name: "Beginner UI check", strategy_type: "beginner_reversal",
      });
      (review.getStrategyVersionById as jest.Mock).mockResolvedValue({
        id: "ver-beginner", strategyId: "cfg-beginner", config: { symbols: ["SPY"], maxPositionQty: 2 },
      });
      (repositories.countRunningRunsForOwner as jest.Mock).mockResolvedValue(0);
      (repositories.insertStrategyRun as jest.Mock).mockResolvedValue(undefined);
      const activate = jest.fn();
      const prepare = jest.fn().mockResolvedValue(undefined);
      const runner = createApp({
        executionMode: "paper", executionTarget: "sim",
        orchestrator: { hasStrategyWithConfigId: () => false },
        liveRuns: {
          prepare, activate,
          leaseFields: () => ({ leaseOwner: "test-runner", leaseExpiresAt: Date.now() + 90_000 }),
        },
      } as unknown as AppContext);

      const res = await request(runner).post("/api/strategies/start")
        .set("Authorization", "Bearer valid")
        .send({ strategyId: "cfg-beginner", versionId: "ver-beginner" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ strategyType: "beginner_reversal", executionMode: "paper", versionId: "ver-beginner" });
      const strategy = prepare.mock.calls[0][0];
      expect(strategy).toBeInstanceOf(BeginnerReversalStrategy);
      expect(strategy.config).toMatchObject({ id: "cfg-beginner", symbols: ["SPY"], qtyPerTrade: 1, maxPositionQty: 2 });
      expect(activate).toHaveBeenCalledWith(res.body.id, strategy, expect.any(Number));
      expect((repositories.insertStrategyRun as jest.Mock).mock.invocationCallOrder[0])
        .toBeLessThan(activate.mock.invocationCallOrder[0]);
    });

    test("returns 503 when no orchestrator context (API-only mode)", async () => {
      signedInAs();
      const res = await request(app)
        .post("/api/strategies/start")
        .set("Authorization", "Bearer valid")
        .send({ strategyId: "cfg-1", versionId: "ver-1" });
      expect(res.status).toBe(503);
    });

    test("returns 401 without a signed-in caller", async () => {
      const res = await request(app)
        .post("/api/strategies/start")
        .send({ strategyId: "cfg-1", versionId: "ver-1" });
      expect(res.status).toBe(401);
    });

    test("returns 400 when strategyId is missing", async () => {
      signedInAs();
      const res = await request(app)
        .post("/api/strategies/start")
        .set("Authorization", "Bearer valid")
        .send({});
      expect(res.status).toBe(400);
    });

    test("does not accept caller-supplied strategy configs", async () => {
      signedInAs();
      const res = await request(app)
        .post("/api/strategies/start")
        .set("Authorization", "Bearer valid")
        .send({ strategyType: "unknown_strategy", config: { name: "x" } });
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/strategies/:id/stop — stop a run
  // -------------------------------------------------------------------------
  describe("POST /api/strategies/:id/stop", () => {
    test("returns 503 when no orchestrator context (API-only mode)", async () => {
      signedInAs();
      const res = await request(app)
        .post("/api/strategies/run-1/stop")
        .set("Authorization", "Bearer valid");
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
      const res = await request(app).get("/api/strategies/configs").set("Authorization", "Bearer valid");
      expect(res.status).toBe(200);
      // Derived at runtime from the strategy class, so assert against the constant
      // rather than a literal — a VERSION bump is a deliberate change, not a break.
      expect(res.body).toEqual([
        expect.objectContaining({ id: "cfg-1", name: "My Pairs", algorithmVersion: PairsStrategy.VERSION }),
      ]);
    });
  });

  // The release gate: status decides what can be listed and created, never what already runs.
  describe("strategy status gate", () => {
    const definition = STRATEGY_DEFINITIONS.beginner_reversal;
    const original = definition.status;
    afterEach(() => { definition.status = original; });

    test("GET /configs/types hides planned types and exposes the ready beginner strategy with its form", async () => {
      signedInAs();
      definition.status = "planned";
      const hidden = await request(app).get("/api/strategies/configs/types").set("Authorization", "Bearer valid");
      expect(hidden.status).toBe(200);
      expect(hidden.body.map((d: { type: string }) => d.type)).toEqual(
        expect.arrayContaining(["pairs_trading"]),
      );
      expect(hidden.body.map((d: { type: string }) => d.type)).not.toContain("beginner_reversal");

      definition.status = "ready";
      const shown = await request(app).get("/api/strategies/configs/types").set("Authorization", "Bearer valid");
      expect(shown.status).toBe(200);
      expect(shown.body).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "beginner_reversal",
          status: "ready",
          actions: expect.objectContaining({
            save: { allowed: true }, backtest: { allowed: true }, startTrading: { allowed: true },
          }),
          params: expect.arrayContaining([
            expect.objectContaining({ key: "symbols", kind: "symbols" }),
            expect.objectContaining({ key: "qtyPerTrade", kind: "number" }),
            expect.objectContaining({ key: "maxPositionQty", kind: "number" }),
          ]),
        }),
      ]));
    });

    test("POST /configs refuses a planned type but accepts it once ready", async () => {
      signedInAs("user-1");
      (repositories.insertStrategy as jest.Mock).mockResolvedValue({
        id: "cfg-2", strategy_type: "beginner_reversal", name: "test",
      });
      mockInsertStrategyVersion.mockResolvedValue({ id: "ver-1", versionNumber: 1 });
      const body = { strategy_type: "beginner_reversal", name: "test", config: { symbols: ["SPY"] } };

      definition.status = "planned";
      const refused = await request(app).post("/api/strategies/configs").set("Authorization", "Bearer valid").send(body);
      expect(refused.status).toBe(400);
      expect(repositories.insertStrategy).not.toHaveBeenCalled();

      definition.status = "ready";
      const accepted = await request(app).post("/api/strategies/configs").set("Authorization", "Bearer valid").send(body);
      expect(accepted.status).toBe(201);
    });

    test("restoring a persisted run still resolves the factory for a non-ready type", () => {
      definition.status = "retired";
      expect(STRATEGY_FACTORY.beginner_reversal).toBeInstanceOf(Function);
      expect(strategyDefinition("beginner_reversal")?.actions.startTrading.allowed).toBe(false);
    });
  });

  // A mistake is reported to its author when the config is saved, not at start.
  describe("save-time config validation", () => {
    const badMinuteReversal = { symbols: ["NVDA"], qtyPerTrade: 0 };

    test("POST /configs rejects an unrunnable config with the strategy's message", async () => {
      signedInAs();
      const res = await request(app)
        .post("/api/strategies/configs")
        .set("Authorization", "Bearer valid")
        .send({ strategy_type: "minute_reversal", name: "bad", config: badMinuteReversal });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/^Invalid configuration: .*qtyPerTrade must be a positive whole number/);
      expect(repositories.insertStrategy).not.toHaveBeenCalled();
    });

    test("POST /configs still accepts a valid config", async () => {
      signedInAs("user-1");
      (repositories.insertStrategy as jest.Mock).mockResolvedValue({ id: "cfg-3", strategy_type: "minute_reversal", name: "ok" });
      mockInsertStrategyVersion.mockResolvedValue({ id: "ver-1", versionNumber: 1 });
      const res = await request(app)
        .post("/api/strategies/configs")
        .set("Authorization", "Bearer valid")
        .send({ strategy_type: "minute_reversal", name: "ok", config: { symbols: ["NVDA"], qtyPerTrade: 1, maxPositionQty: 2 } });
      expect(res.status).toBe(201);
    });

    test("PUT /configs/:id rejects an unrunnable edit and saves no version", async () => {
      signedInAs("user-1");
      mockGetStrategyById.mockResolvedValue({
        id: "cfg-1", name: "old", strategy_type: "minute_reversal", config: {}, owner_id: "user-1",
      });
      const res = await request(app)
        .put("/api/strategies/configs/cfg-1")
        .set("Authorization", "Bearer valid")
        .send({ name: "Updated", config: badMinuteReversal });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid configuration");
      expect(review.saveStrategyVersion).not.toHaveBeenCalled();
    });

    test("a strategy with no validate hook (pairs trading) is saved as before", async () => {
      signedInAs("user-1");
      mockGetStrategyById.mockResolvedValue({
        id: "cfg-1", name: "old", strategy_type: "pairs_trading", config: {}, owner_id: "user-1",
      });
      const res = await request(app)
        .put("/api/strategies/configs/cfg-1")
        .set("Authorization", "Bearer valid")
        .send({ name: "Updated", config: {} });
      expect(res.status).toBe(200);
      // Each saved version records the algorithm it was written for.
      expect(review.saveStrategyVersion).toHaveBeenCalledWith(
        expect.objectContaining({ strategyId: "cfg-1", algorithmVersion: PairsStrategy.VERSION }),
      );
    });
  });

  describe("GET /api/strategies/configs/defaults/:type", () => {
    test("returns 200 with default config for pairs_trading", async () => {
      const res = await request(app).get("/api/strategies/configs/defaults/pairs_trading").set("Authorization", "Bearer valid");
      expect(res.status).toBe(200);
      expect(res.body.type).toBe("pairs_trading");
      expect(res.body.defaultConfig).toBeDefined();
    });

    test("returns 404 for unknown strategy type", async () => {
      const res = await request(app).get("/api/strategies/configs/defaults/unknown_type").set("Authorization", "Bearer valid");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/strategies/configs", () => {
    test("returns 401 without a signed-in caller", async () => {
      const res = await request(app)
        .post("/api/strategies/configs")
        .send({ strategy_type: "pairs_trading", name: "test", config: {} });
      expect(res.status).toBe(401);
    });

    test("returns 400 when required fields are missing", async () => {
      signedInAs();
      const res = await request(app)
        .post("/api/strategies/configs")
        .set("Authorization", "Bearer valid")
        .send({ name: "test" }); // missing strategy_type and config
      expect(res.status).toBe(400);
    });

    test("returns 400 for unknown strategy type", async () => {
      signedInAs();
      const res = await request(app)
        .post("/api/strategies/configs")
        .set("Authorization", "Bearer valid")
        .send({ strategy_type: "unknown", name: "test", config: {} });
      expect(res.status).toBe(400);
    });

    test("creates the strategy and its v1 version together", async () => {
      signedInAs("user-1");
      (repositories.insertStrategy as jest.Mock).mockResolvedValue({
        id: "cfg-1", strategy_type: "pairs_trading", name: "test", config: { symbols: ["SPY", "QQQ"] },
      });
      mockInsertStrategyVersion.mockResolvedValue({ id: "ver-1", versionNumber: 1 });

      const res = await request(app)
        .post("/api/strategies/configs")
        .set("Authorization", "Bearer valid")
        .send({ strategy_type: "pairs_trading", name: "test", config: { symbols: ["SPY", "QQQ"] } });

      expect(res.status).toBe(201);
      expect(mockInsertStrategyVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          strategyId: "cfg-1",
          changeSummary: "Initial version",
          createdBy: "user-1",
          algorithmVersion: PairsStrategy.VERSION,
        }),
      );
    });

    test("rolls back the strategy row if the v1 version insert fails", async () => {
      signedInAs("user-1");
      (repositories.insertStrategy as jest.Mock).mockResolvedValue({ id: "cfg-1", strategy_type: "pairs_trading", name: "test" });
      mockInsertStrategyVersion.mockRejectedValue(new Error("db down"));

      const res = await request(app)
        .post("/api/strategies/configs")
        .set("Authorization", "Bearer valid")
        .send({ strategy_type: "pairs_trading", name: "test", config: {} });

      expect(res.status).toBe(500);
      expect(repositories.deleteStrategy).toHaveBeenCalledWith("cfg-1");
    });
  });

  describe("PUT /api/strategies/configs/:configId", () => {
    test("returns 401 without a signed-in caller", async () => {
      const res = await request(app)
        .put("/api/strategies/configs/cfg-1")
        .send({ name: "Updated", config: {} });
      expect(res.status).toBe(401);
    });

    test("returns 404 when config does not exist", async () => {
      signedInAs();
      mockGetStrategyById.mockResolvedValue(null);
      const res = await request(app)
        .put("/api/strategies/configs/missing-id")
        .set("Authorization", "Bearer valid")
        .send({ name: "Updated", config: {} });
      expect(res.status).toBe(404);
    });

    test("returns 400 when name or config is missing", async () => {
      signedInAs();
      const res = await request(app)
        .put("/api/strategies/configs/cfg-1")
        .set("Authorization", "Bearer valid")
        .send({ name: "Only name" }); // missing config
      expect(res.status).toBe(400);
    });

    test("the owner may update a config and creates a new version", async () => {
      signedInAs("user-1");
      mockGetStrategyById.mockResolvedValue({ id: "cfg-1", name: "old", config: {}, owner_id: "user-1" });
      mockInsertStrategyVersion.mockResolvedValue({ id: "ver-2", versionNumber: 2 });
      const res = await request(app)
        .put("/api/strategies/configs/cfg-1")
        .set("Authorization", "Bearer valid")
        .send({ name: "Updated", config: { symbols: ["SPY", "QQQ"] } });
      expect(res.status).toBe(200);
    });
  });

  describe("DELETE /api/strategies/configs/:configId", () => {
    test("returns 200 on successful delete of a draft with no history", async () => {
      signedInAs("user-1");
      mockGetStrategyById.mockResolvedValue({ id: "cfg-1", owner_id: "user-1" });
      (repositories.getStrategyHistoryCounts as jest.Mock).mockResolvedValue({ runs: 0, proposals: 0 });
      (repositories.deleteStrategy as jest.Mock).mockResolvedValue(undefined);
      const res = await request(app)
        .delete("/api/strategies/configs/cfg-1")
        .set("Authorization", "Bearer valid");
      expect(res.status).toBe(200);
      expect(res.body.message).toBeDefined();
    });

    test("refuses with 409 when the strategy has run history, without deleting", async () => {
      signedInAs("user-1");
      mockGetStrategyById.mockResolvedValue({ id: "cfg-1", owner_id: "user-1" });
      (repositories.getStrategyHistoryCounts as jest.Mock).mockResolvedValue({ runs: 3, proposals: 0 });
      const res = await request(app)
        .delete("/api/strategies/configs/cfg-1")
        .set("Authorization", "Bearer valid");
      expect(res.status).toBe(409);
      expect(res.body.history).toEqual({ runs: 3, proposals: 0 });
      expect(repositories.deleteStrategy).not.toHaveBeenCalled();
    });

    test("reports 500 instead of success when the database rejects the delete", async () => {
      signedInAs("user-1");
      mockGetStrategyById.mockResolvedValue({ id: "cfg-1", owner_id: "user-1" });
      (repositories.getStrategyHistoryCounts as jest.Mock).mockResolvedValue({ runs: 0, proposals: 0 });
      (repositories.deleteStrategy as jest.Mock).mockRejectedValue(new Error("deleteStrategy failed: fk"));
      const res = await request(app)
        .delete("/api/strategies/configs/cfg-1")
        .set("Authorization", "Bearer valid");
      expect(res.status).toBe(500);
    });

    test("refuses a member deleting someone else's strategy", async () => {
      signedInAs("user-2");
      mockGetStrategyById.mockResolvedValue({ id: "cfg-1", owner_id: "user-1" });
      const res = await request(app)
        .delete("/api/strategies/configs/cfg-1")
        .set("Authorization", "Bearer valid");
      expect(res.status).toBe(403);
      expect(repositories.deleteStrategy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Portfolio orders endpoint
  // -------------------------------------------------------------------------
  describe("GET /api/portfolio/orders", () => {
    test("returns all orders when strategyRunId is absent", async () => {
      (repositories.getAllOrders as jest.Mock).mockResolvedValue([{ id: "o1" }]);
      const res = await request(app).get("/api/portfolio/orders").set("Authorization", "Bearer valid");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    test("returns filtered orders when strategyRunId is provided", async () => {
      (repositories.getOrdersByStrategyRun as jest.Mock).mockResolvedValue([{ id: "o2" }]);
      const res = await request(app).get("/api/portfolio/orders?strategyRunId=run-1").set("Authorization", "Bearer valid");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });
});

describe("Read routes require a signed-in member", () => {
  test.each(["/api/strategies", "/api/strategies/configs", "/api/portfolio/orders", "/api/portfolio/fills", "/api/runs/run-1/performance", "/api/broker/account"])(
    "GET %s without a token is 401",
    async (path) => {
      const res = await request(createApp({})).get(path);
      expect(res.status).toBe(401);
    },
  );
});
