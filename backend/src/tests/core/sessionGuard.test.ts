import fs from "node:fs";
import path from "node:path";
import { WeeklyConfigManager } from "../../strategies/momentum/weeklyConfigLoader";
import { SessionGuard, type SessionGuardDeps, type SessionInfo } from "../../core/live/sessionGuard";

const DATE = "2026-11-24";
const OPEN = Date.parse("2026-11-24T14:30:00Z");
const CLOSE = Date.parse("2026-11-24T21:00:00Z");
const EARLY_CLOSE = Date.parse("2026-11-24T18:00:00Z");
const ACCT = "PA-TEST";

function selected(): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "strategy", "fixtures", "weeklyConfig", "selected.json"), "utf8"),
  );
}

function setup(over: Partial<SessionGuardDeps> = {}, now = OPEN - 600_000, raw: unknown = selected()) {
  const mgr = new WeeklyConfigManager();
  mgr.submit(raw);
  const session: SessionInfo = { isTradingDay: true, openMs: OPEN, closeMs: CLOSE, earlyClose: false };
  const deps: SessionGuardDeps = {
    resolveConfig: (d, f) => mgr.resolve(d, f),
    getSession: async () => session,
    getBrokerAccountNumber: async () => ACCT,
    getBrokerPositions: async () => [],
    getBrokerOpenOrders: async () => [],
    getInternalPositions: () => [],
    getInternalOpenOrders: () => [],
    getDataStatus: () => ({ connected: true, lastDataAtMs: now - 1000 }),
    getOrderConnectionStatus: () => ({ connected: true }),
    nowMs: () => now,
    ...over,
  };
  const guard = new SessionGuard(deps, { allowedAccountNumbers: [ACCT], dataMaxAgeMs: 120_000, positionQtyTolerance: 0 });
  return { guard, mgr };
}
const codes = (d: { reasons: { code: string }[] }) => d.reasons.map((r) => r.code);

describe("SessionGuard", () => {
  it("fails closed before any check", () => {
    expect(setup().guard.entriesAllowed()).toBe(false);
  });

  it("allows entries when everything is healthy", async () => {
    const { guard } = setup();
    const d = await guard.check(DATE);
    expect(d.reasons).toEqual([]);
    expect(d.entriesAllowed).toBe(true);
    expect(d.entryConfig?.run_id).toBeTruthy();
    expect(guard.entriesAllowed()).toBe(true);
  });

  it("blocks on a missing, invalid, or stale weekly config", async () => {
    let d = await setup({}, OPEN - 600_000, null).guard.check(DATE);
    expect(codes(d)).toContain("config_missing");
    d = await setup({}, OPEN - 600_000, { nope: 1 }).guard.check(DATE);
    expect(d.entriesAllowed).toBe(false);
    expect(codes(d).some((c) => c === "config_invalid" || c === "config_unknown_version")).toBe(true);
    d = await setup().guard.check("2026-12-15");
    expect(codes(d)).toContain("config_stale");
    d = await setup().guard.check("2026-11-20");
    expect(codes(d)).toContain("config_not_yet_active");
  });

  it("blocks on a non-trading day, missing calendar, and after close", async () => {
    let d = await setup({
      getSession: async () => ({ isTradingDay: false, openMs: OPEN, closeMs: CLOSE, earlyClose: false }),
    }).guard.check(DATE);
    expect(codes(d)).toContain("not_trading_day");
    d = await setup({ getSession: async () => null }).guard.check(DATE);
    expect(codes(d)).toContain("calendar_unavailable");
    d = await setup({
      getSession: async () => {
        throw new Error("boom");
      },
    }).guard.check(DATE);
    expect(codes(d)).toContain("calendar_unavailable");
    d = await setup({}, CLOSE + 1).guard.check(DATE);
    expect(codes(d)).toContain("session_closed");
  });

  it("honours early closes and the config entry cutoff", async () => {
    const early = {
      getSession: async () => ({ isTradingDay: true, openMs: OPEN, closeMs: EARLY_CLOSE, earlyClose: true }),
    };
    // fixture: session_exit_minutes_before_close = 5
    let d = await setup(early, EARLY_CLOSE - 4 * 60_000).guard.check(DATE);
    expect(codes(d)).toContain("entry_window_closed");
    d = await setup(early, EARLY_CLOSE - 6 * 60_000).guard.check(DATE);
    expect(codes(d)).not.toContain("entry_window_closed");
    d = await setup(early, EARLY_CLOSE + 1).guard.check(DATE);
    expect(codes(d)).toContain("session_closed");
  });

  it("blocks when the account is not the dedicated one or is unreadable", async () => {
    let d = await setup({ getBrokerAccountNumber: async () => "PA-OTHER" }).guard.check(DATE);
    expect(codes(d)).toContain("account_not_dedicated");
    d = await setup({
      getBrokerAccountNumber: async () => {
        throw new Error("x");
      },
    }).guard.check(DATE);
    expect(codes(d)).toContain("account_unreadable");
  });

  it("blocks on position and order mismatches", async () => {
    let d = await setup({
      getBrokerPositions: async () => [{ symbol: "AAPL", qty: 10 }],
      getInternalPositions: () => [{ symbol: "AAPL", qty: 5 }],
    }).guard.check(DATE);
    expect(codes(d)).toContain("position_mismatch");
    d = await setup({ getBrokerOpenOrders: async () => [{ orderId: "b1", symbol: "AAPL" }] }).guard.check(DATE);
    expect(codes(d)).toContain("order_mismatch");
    d = await setup({ getInternalOpenOrders: () => [{ orderId: "i1", symbol: "AAPL" }] }).guard.check(DATE);
    expect(codes(d)).toContain("order_mismatch");
  });

  it("blocks when the broker is unreachable and does not assume flat", async () => {
    const { guard, mgr } = setup({
      getBrokerPositions: async () => {
        throw new Error("down");
      },
    });
    const d = await guard.check(DATE);
    expect(codes(d)).toContain("broker_unreachable");
    expect(d.entriesAllowed).toBe(false);
    expect(mgr.activeConfig).toBeNull();
  });

  it("blocks on connection failures and on stale data once open", async () => {
    let d = await setup({ getDataStatus: () => ({ connected: false, lastDataAtMs: null }) }).guard.check(DATE);
    expect(codes(d)).toContain("data_connection_down");
    d = await setup({ getOrderConnectionStatus: () => ({ connected: false }) }).guard.check(DATE);
    expect(codes(d)).toContain("order_connection_down");
    d = await setup({ getDataStatus: () => ({ connected: true, lastDataAtMs: null }) }).guard.check(DATE);
    expect(codes(d)).not.toContain("data_stale"); // pre-open: no bars yet
    const now = OPEN + 600_000;
    d = await setup({ getDataStatus: () => ({ connected: true, lastDataAtMs: now - 300_000 }) }, now).guard.check(DATE);
    expect(codes(d)).toContain("data_stale");
    d = await setup({
      getDataStatus: () => {
        throw new Error("probe");
      },
    }).guard.check(DATE);
    expect(codes(d)).toContain("health_check_error");
  });

  it("keeps exits and protection for open positions while entries are blocked", async () => {
    const pos = [{ symbol: "AAPL", qty: 10 }];
    const { guard } = setup({
      getBrokerPositions: async () => pos,
      getInternalPositions: () => pos,
      getBrokerAccountNumber: async () => "PA-OTHER",
    });
    // Adopt the config while flat first, as the live runtime would have.
    const d = await guard.check(DATE);
    expect(d.entriesAllowed).toBe(false);
    expect(d.exitsAllowed).toBe(true);
    expect(d.protectedSymbols).toEqual(["AAPL"]);
  });

  it("restart with a position mismatch keeps entries off until reconciled", async () => {
    let brokerQty = 7;
    const { guard } = setup({
      getBrokerPositions: async () => [{ symbol: "AAPL", qty: brokerQty }],
      getInternalPositions: () => [{ symbol: "AAPL", qty: 10 }],
    });
    guard.markRestart();
    expect(guard.entriesAllowed()).toBe(false);
    const d = await guard.check(DATE);
    expect(codes(d)).toContain("position_mismatch");
    expect(guard.entriesAllowed()).toBe(false);
    brokerQty = 10;
    expect(codes(await guard.check(DATE))).not.toContain("position_mismatch");
  });

  it("restart while flat and consistent re-enables entries only after check()", async () => {
    const { guard } = setup();
    await guard.check(DATE);
    guard.markRestart();
    expect(guard.entriesAllowed()).toBe(false);
    expect((await guard.check(DATE)).entriesAllowed).toBe(true);
    expect(guard.entriesAllowed()).toBe(true);
  });
});
