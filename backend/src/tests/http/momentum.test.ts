/**
 * tests/http/momentum.test.ts
 *
 * Momentum dashboard API: signed-in reads, ingest-token uploads, schema
 * validation against the 0-A fixtures, and fail-closed entry status.
 */

jest.mock("../../adapters/supabase/client");
jest.mock("../../adapters/supabase/reviewRepositories");
jest.mock("../../adapters/supabase/repositories");
jest.mock("../../adapters/supabase/momentumArtifactRepository", () => ({
  ...jest.requireActual("../../adapters/supabase/momentumArtifactRepository"),
  insertMomentumArtifact: jest.fn(),
  findActiveWeeklyConfig: jest.fn(),
  findLatestWeeklyConfig: jest.fn(),
  findLatestResultsSummary: jest.fn(),
}));
jest.mock("../../config/env", () => ({
  env: {
    supabaseUrl: "https://test.supabase.co",
    supabaseAnonKey: "test-anon",
    supabaseServiceRoleKey: "test-service",
    port: 8080,
    nodeEnv: "test",
    corsOrigin: "http://localhost:3000",
    logLevel: "error",
    momentumIngestToken: "ingest-secret",
    momentumArtifactMaxAgeHours: 216,
  },
}));

import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { createApp } from "../../app/index";
import { getSupabaseClient } from "../../adapters/supabase/client";
import * as review from "../../adapters/supabase/reviewRepositories";
import * as repo from "../../adapters/supabase/momentumArtifactRepository";
import { setMomentumRuntimeProvider } from "../../app/controllers/momentumController";
import { validateWeeklyConfig } from "../../app/controllers/momentumValidation";

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/momentum", name), "utf8"));
const selected = fixture("selected.json");
const noDeployment = fixture("no_deployment.json");

const mockGetUser = jest.fn();
(getSupabaseClient as jest.Mock).mockReturnValue({ auth: { getUser: mockGetUser } });
const findActive = repo.findActiveWeeklyConfig as jest.Mock;
const findLatest = repo.findLatestWeeklyConfig as jest.Mock;
const findSummary = repo.findLatestResultsSummary as jest.Mock;
const insert = repo.insertMomentumArtifact as jest.Mock;

function signIn() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  (review.getAppUserById as jest.Mock).mockResolvedValue({
    id: "u1", email: "m@shpe.test", displayName: "M", role: "member", membershipStatus: "active",
  });
}

const row = (payload: unknown, extra: Record<string, unknown> = {}) => ({
  id: "row-1", kind: "weekly_config", run_id: "r", policy: "similarity",
  activation_start: "2026-11-23", activation_end: "2026-11-27", payload, created_at: "2026-11-20T21:05:00Z", ...extra,
});

const summary = {
  meta: {
    strategy: "momentum", dataVersion: "snapshot-2026-11-13", costModel: "10 bps per side",
    forwardPeriod: { start: "2026-01-05", end: "2026-11-13" }, generatedAt: "2026-11-14T00:00:00Z",
  },
  policies: ["similarity", "recency", "uniform"].map((policy) => ({
    policy, cumulativeNetReturn: 0.1, endingEquity: 110000, maxDrawdown: 0.04, avgDailyReturn: 0.0004,
    downsideDeviation: 0.003, tradeCount: 100, activeDays: 120, noDeploymentWeeks: 2, avgHoldMinutes: 35,
    exposure: 0.3, turnover: 4, rejectedSignals: 5, concentration: { topWeeksShare: 0.3, topStocksShare: 0.2 },
    calibrationRuntimeSeconds: 600,
  })),
  equity: [{ date: "2026-01-05", similarity: 1, recency: 1, uniform: 1 }],
  paired: { meanDaily: 0.0001, nDays: 200, resamples: 1000, intervals: [{ blockLength: 5, primary: true, lo: -0.0001, hi: 0.0003 }] },
  costSensitivity: [{ bps: 10, similarity: 0.1, recency: 0.09, uniform: 0.08 }],
  weekly: [{
    weekStart: "2026-11-23",
    similarity: { configId: "5575e5f41ca2e9a0", netReturn: 0.01, noDeploymentReason: null },
    recency: { configId: null, netReturn: 0, noDeploymentReason: "acceptance failed" },
    uniform: { configId: null, netReturn: 0, noDeploymentReason: "acceptance failed" },
  }],
};

const app = createApp();
const AUTH = { Authorization: "Bearer ingest-secret" };

beforeEach(() => {
  jest.clearAllMocks();
  setMomentumRuntimeProvider(null);
  jest.useFakeTimers({
    now: new Date("2026-11-24T15:00:00Z"),
    doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "clearImmediate", "queueMicrotask", "performance", "hrtime"],
  });
});
afterEach(() => jest.useRealTimers());

describe("weekly config validator", () => {
  test("accepts both 0-A fixtures", () => {
    expect(validateWeeklyConfig(selected)).toEqual([]);
    expect(validateWeeklyConfig(noDeployment)).toEqual([]);
  });

  test("rejects unknown version, extra keys, bad config_id and ambiguous deployment", () => {
    expect(validateWeeklyConfig({ ...selected, schema_version: "weekly_config.v2" })).not.toEqual([]);
    expect(validateWeeklyConfig({ ...selected, extra: 1 })).not.toEqual([]);
    expect(validateWeeklyConfig({ ...selected, selected: { ...selected.selected, config_id: "XYZ" } })).not.toEqual([]);
    expect(validateWeeklyConfig({ ...selected, no_deployment: { reason: "x" } })).not.toEqual([]);
    expect(validateWeeklyConfig({ ...selected, selected: null, no_deployment: null })).not.toEqual([]);
    expect(validateWeeklyConfig(null)).not.toEqual([]);
  });
});

describe("GET /api/momentum/config and /status", () => {
  test("require a signed-in member", async () => {
    expect((await request(app).get("/api/momentum/config")).status).toBe(401);
    expect((await request(app).get("/api/momentum/status")).status).toBe(401);
    expect(findActive).not.toHaveBeenCalled();
  });

  test("rejects an unknown policy", async () => {
    signIn();
    expect((await request(app).get("/api/momentum/config?policy=bogus").set("Authorization", "Bearer t")).status).toBe(400);
  });

  test("returns the active config with entries enabled", async () => {
    signIn();
    findActive.mockResolvedValue(row(selected));
    const res = await request(app).get("/api/momentum/config?policy=similarity").set("Authorization", "Bearer t");
    expect(res.status).toBe(200);
    expect(findActive).toHaveBeenCalledWith("2026-11-24", "similarity");
    expect(res.body.active).toBe(true);
    expect(res.body.entries).toEqual({ enabled: true, code: null, reason: null });
    expect(res.body.config).toMatchObject({
      configId: "5575e5f41ca2e9a0", policy: "similarity", subset: ["adx", "breakout"],
      activation: { start: "2026-11-23", end: "2026-11-27" }, universe: { size: 3, symbols: ["AAPL", "MSFT", "NVDA"] },
      freshness: { stale: false, limitHours: 216 },
    });
    expect(res.body.config.params["breakout.n"]).toBe(20);
    expect(res.body.config.exit.max_hold_minutes).toBeDefined();
    expect(JSON.stringify(res.body)).not.toMatch(/token|secret|api_?key/i);
  });

  test("no_deployment disables entries with the reason", async () => {
    signIn();
    findActive.mockResolvedValue(row(noDeployment, { policy: "uniform" }));
    const res = await request(app).get("/api/momentum/status").set("Authorization", "Bearer t");
    expect(res.status).toBe(200);
    expect(res.body.entries.enabled).toBe(false);
    expect(res.body.entries.code).toBe("no_deployment");
    expect(res.body.entries.reason).toBe(noDeployment.no_deployment.reason);
    expect(res.body.config.noDeploymentReason).toBe(noDeployment.no_deployment.reason);
  });

  test("missing artifact disables entries", async () => {
    signIn();
    findActive.mockResolvedValue(null);
    findLatest.mockResolvedValue(null);
    const res = await request(app).get("/api/momentum/status").set("Authorization", "Bearer t");
    expect(res.body.entries).toMatchObject({ enabled: false, code: "no_artifact" });
    expect(res.body.config).toBeNull();
  });

  test("an artifact for another week is outside_activation_week", async () => {
    signIn();
    findActive.mockResolvedValue(null);
    findLatest.mockResolvedValue(row(selected));
    const res = await request(app).get("/api/momentum/status").set("Authorization", "Bearer t");
    expect(res.body.entries.code).toBe("outside_activation_week");
  });

  test("stale artifact disables entries", async () => {
    signIn();
    findActive.mockResolvedValue(row({ ...selected, decision_cutoff: "2026-11-01T21:00:00Z" }));
    const res = await request(app).get("/api/momentum/status").set("Authorization", "Bearer t");
    expect(res.body.entries).toMatchObject({ enabled: false, code: "stale_artifact" });
    expect(res.body.config.freshness.stale).toBe(true);
  });

  test("an invalid stored artifact fails closed and is not returned", async () => {
    signIn();
    findActive.mockResolvedValue(row({ ...selected, schema_version: "weekly_config.v9" }));
    const res = await request(app).get("/api/momentum/config").set("Authorization", "Bearer t");
    expect(res.status).toBe(200);
    expect(res.body.entries).toMatchObject({ enabled: false, code: "invalid_artifact" });
    expect(res.body.config).toBeNull();
    expect(res.body.active).toBe(false);
  });

  test("status merges runtime positions and a daily halt disables entries", async () => {
    signIn();
    findActive.mockResolvedValue(row(selected));
    setMomentumRuntimeProvider(async () => ({
      positions: [{ symbol: "AAPL", qty: 10, entryPrice: 100, lastPrice: 101, stopPrice: 98, enteredAt: "2026-11-24T14:35:00Z" }],
      halt: { dayPnl: -1200, dayPnlPct: -0.012, halted: true },
      lastBarAt: "2026-11-24T14:59:00Z",
    }));
    const res = await request(app).get("/api/momentum/status").set("Authorization", "Bearer t");
    expect(res.body.runtimeConnected).toBe(true);
    expect(res.body.positions).toHaveLength(1);
    expect(res.body.entries).toMatchObject({ enabled: false, code: "daily_halt" });
    expect(res.body.halt).toMatchObject({ halted: true, haltPct: selected.account.daily_halt_pct });
    expect(res.body.lastBarAt).toBe("2026-11-24T14:59:00Z");
  });

  test("a failing runtime provider degrades to runtimeConnected=false", async () => {
    signIn();
    findActive.mockResolvedValue(row(selected));
    setMomentumRuntimeProvider(async () => { throw new Error("boom"); });
    const res = await request(app).get("/api/momentum/status").set("Authorization", "Bearer t");
    expect(res.status).toBe(200);
    expect(res.body.runtimeConnected).toBe(false);
  });

  test("a repository failure is a 500 without internals", async () => {
    signIn();
    findActive.mockRejectedValue(new Error("db password leaked"));
    const res = await request(app).get("/api/momentum/config").set("Authorization", "Bearer t");
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/password/);
  });
});

describe("GET /api/momentum/results/summary", () => {
  test("requires sign-in", async () => {
    expect((await request(app).get("/api/momentum/results/summary")).status).toBe(401);
  });

  test("404 when nothing uploaded", async () => {
    signIn();
    findSummary.mockResolvedValue(null);
    expect((await request(app).get("/api/momentum/results/summary").set("Authorization", "Bearer t")).status).toBe(404);
  });

  test("returns the stored summary", async () => {
    signIn();
    findSummary.mockResolvedValue({ ...row(summary), kind: "results_summary" });
    const res = await request(app).get("/api/momentum/results/summary").set("Authorization", "Bearer t");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(summary);
  });

  test("an invalid stored summary is refused", async () => {
    signIn();
    findSummary.mockResolvedValue({ ...row({ ...summary, weekly: "nope" }), kind: "results_summary" });
    expect((await request(app).get("/api/momentum/results/summary").set("Authorization", "Bearer t")).status).toBe(500);
  });
});

describe("POST uploads (ingest token)", () => {
  test("refuse a missing or wrong token and a member JWT", async () => {
    expect((await request(app).post("/api/momentum/artifacts/weekly-config").send(selected)).status).toBe(401);
    expect((await request(app).post("/api/momentum/artifacts/weekly-config").set("Authorization", "Bearer wrong").send(selected)).status).toBe(401);
    expect((await request(app).post("/api/momentum/results/summary").set("Authorization", "Bearer wrong").send(summary)).status).toBe(401);
    expect(insert).not.toHaveBeenCalled();
  });

  test("stores a valid weekly config", async () => {
    insert.mockResolvedValue({ id: "id1", run_id: selected.run_id, created_at: "2026-11-20T21:05:00Z" });
    const res = await request(app).post("/api/momentum/artifacts/weekly-config").set(AUTH).send(selected);
    expect(res.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      kind: "weekly_config", runId: selected.run_id, policy: "similarity", activationStart: "2026-11-23", activationEnd: "2026-11-27",
    }));
  });

  test("rejects an invalid weekly config with 422 and stores nothing", async () => {
    const res = await request(app).post("/api/momentum/artifacts/weekly-config").set(AUTH).send({ ...selected, schema_version: "weekly_config.v2" });
    expect(res.status).toBe(422);
    expect(res.body.details.length).toBeGreaterThan(0);
    expect(insert).not.toHaveBeenCalled();
  });

  test("a duplicate run is 409", async () => {
    insert.mockRejectedValue(new repo.MomentumArtifactConflictError("weekly_config", selected.run_id));
    const res = await request(app).post("/api/momentum/artifacts/weekly-config").set(AUTH).send(selected);
    expect(res.status).toBe(409);
  });

  test("stores a valid results summary and rejects an invalid one", async () => {
    insert.mockResolvedValue({ id: "id2", run_id: "x", created_at: "2026-11-14T00:00:00Z" });
    expect((await request(app).post("/api/momentum/results/summary").set(AUTH).send(summary)).status).toBe(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "results_summary" }));
    insert.mockClear();
    const bad = await request(app).post("/api/momentum/results/summary").set(AUTH).send({ ...summary, extra: true });
    expect(bad.status).toBe(422);
    expect(insert).not.toHaveBeenCalled();
  });
});
