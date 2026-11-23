import fs from "node:fs";
import path from "node:path";
import {
  WeeklyConfigManager,
  computeConfigId,
  entriesBlockReason,
  parseWeeklyConfig,
} from "../../strategies/momentum/weeklyConfigLoader";

function fixture(name: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "weeklyConfig", name), "utf8"));
}
const selected = () => fixture("selected.json");
const noDeployment = () => fixture("no_deployment.json");

// Activation week of both fixtures: Mon 2026-11-23 .. Fri 2026-11-27.
const MON = "2026-11-23";
const FRI = "2026-11-27";

describe("parseWeeklyConfig", () => {
  it("accepts the selected fixture and keeps every field", () => {
    const r = parseWeeklyConfig(selected());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.selected?.params).toEqual({ "adx.period": 14, "adx.q": 20, "breakout.b": 0.1, "breakout.n": 20 });
    expect(r.config.universe.map((u) => u.symbol)).toEqual(["AAPL", "MSFT", "NVDA"]);
    expect(r.config.account.exit.initial_stop_atr).toBe(1.5);
    expect(r.config.account.entry_score_threshold).toBeNull();
    expect(r.config.no_deployment).toBeNull();
  });

  it("accepts the no_deployment fixture", () => {
    const r = parseWeeklyConfig(noDeployment());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.selected).toBeNull();
      expect(r.config.no_deployment?.reason.length).toBeGreaterThan(0);
    }
  });

  it("recomputes the 0-B config_id (matches the research fixture)", () => {
    expect(computeConfigId("v1", ["adx", "breakout"], selected().selected.params)).toBe("5575e5f41ca2e9a0");
  });

  it("refuses a config_id that does not match its content", () => {
    const a = selected();
    a.selected.params["breakout.n"] = 40;
    const r = parseWeeklyConfig(a);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/config_id.*does not match/);
  });

  it("refuses an unknown schema version before anything else", () => {
    const a = selected();
    a.schema_version = "weekly_config.v2";
    const r = parseWeeklyConfig(a);
    expect(r).toMatchObject({ ok: false, reason: "unknown_version" });
  });

  it.each([
    ["not an object", () => "nope"],
    ["array", () => []],
    ["null", () => null],
    ["unknown top-level key", () => ({ ...selected(), surprise: 1 })],
    ["missing required key", () => { const a = selected(); delete a.account; return a; }],
    ["both outcomes set", () => ({ ...selected(), no_deployment: { reason: "x" } })],
    ["neither outcome set", () => ({ ...selected(), selected: null })],
    ["empty no_deployment reason", () => ({ ...noDeployment(), no_deployment: { reason: "" } })],
    ["bad policy", () => ({ ...selected(), policy: "random" })],
    ["naive decision_cutoff", () => ({ ...selected(), decision_cutoff: "2026-11-20T21:00:00" })],
    ["impossible date", () => ({ ...selected(), activation: { start: "2026-02-30", end: "2026-03-01" } })],
    ["activation end before start", () => ({ ...selected(), activation: { start: MON, end: "2026-11-20" } })],
    ["validation overlaps search", () => ({ ...selected(), validation_range: { start: "2026-08-14", end: "2026-11-13" } })],
    ["duplicate asset_id", () => {
      const a = selected();
      a.universe[1].asset_id = a.universe[0].asset_id;
      return a;
    }],
    ["unsorted subset", () => {
      const a = selected();
      a.selected.subset = ["breakout", "adx"];
      return a;
    }],
    ["params do not cover subset", () => {
      const a = selected();
      delete a.selected.params["adx.q"];
      a.selected.subset = ["breakout"];
      a.selected.params["adx.period"] = 14;
      return a;
    }],
    ["non-finite number", () => { const a = selected(); a.account.risk_pct = "0.0025"; return a; }],
    ["non-integer integer field", () => { const a = selected(); a.account.max_positions = 10.5; return a; }],
    ["unknown nested key", () => { const a = selected(); a.account.exit.extra = 1; return a; }],
    ["null entry_score_threshold key missing", () => { const a = selected(); delete a.account.entry_score_threshold; return a; }],
    ["short code_commit", () => ({ ...selected(), code_commit: "abc" })],
  ])("refuses invalid artifact: %s", (_name, make) => {
    const r = parseWeeklyConfig(make());
    expect(r.ok).toBe(false);
  });

  it("never throws on hostile input", () => {
    for (const bad of [undefined, 1, true, { schema_version: {} }, { selected: { params: [] } }]) {
      expect(() => parseWeeklyConfig(bad)).not.toThrow();
      expect(parseWeeklyConfig(bad).ok).toBe(false);
    }
  });
});

describe("entriesBlockReason", () => {
  const cfg = (a: Record<string, any>) => {
    const r = parseWeeklyConfig(a);
    if (!r.ok) throw new Error(r.errors.join(";"));
    return r.config;
  };

  it("allows the whole activation week, inclusive", () => {
    expect(entriesBlockReason(cfg(selected()), MON)).toBeNull();
    expect(entriesBlockReason(cfg(selected()), FRI)).toBeNull();
  });

  it("blocks before activation (not_yet_active) and after (stale)", () => {
    expect(entriesBlockReason(cfg(selected()), "2026-11-20")).toBe("not_yet_active");
    expect(entriesBlockReason(cfg(selected()), "2026-11-30")).toBe("stale");
  });

  it("blocks no_deployment and a failed acceptance verdict", () => {
    expect(entriesBlockReason(cfg(noDeployment()), MON)).toBe("no_deployment");
    const a = selected();
    a.acceptance.passed = false;
    expect(entriesBlockReason(cfg(a), MON)).toBe("acceptance_failed");
  });
});

describe("WeeklyConfigManager (fail closed, switch only while flat)", () => {
  it("is disabled when nothing was ever submitted", () => {
    const m = new WeeklyConfigManager();
    expect(m.resolve(MON, true)).toMatchObject({ entriesAllowed: false, reason: "missing", entryConfig: null });
  });

  it("is disabled when the submission is null (missing artifact)", () => {
    const m = new WeeklyConfigManager();
    m.submit(null);
    expect(m.resolve(MON, true).reason).toBe("missing");
  });

  it("allows entries for a valid artifact inside its week", () => {
    const m = new WeeklyConfigManager();
    m.submit(selected());
    const r = m.resolve(MON, true);
    expect(r.entriesAllowed).toBe(true);
    expect(r.entryConfig?.selected?.config_id).toBe("5575e5f41ca2e9a0");
  });

  it.each([
    ["stale", "2026-11-30", "stale"],
    ["early", "2026-11-20", "not_yet_active"],
  ])("disables entries when the artifact is %s", (_n, date, reason) => {
    const m = new WeeklyConfigManager();
    m.submit(selected());
    expect(m.resolve(date, true)).toMatchObject({ entriesAllowed: false, reason });
  });

  it("disables entries for an invalid artifact and reports why", () => {
    const m = new WeeklyConfigManager();
    m.submit({ ...selected(), policy: "nope" });
    const r = m.resolve(MON, true);
    expect(r).toMatchObject({ entriesAllowed: false, reason: "invalid" });
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("disables entries for an unknown version", () => {
    const m = new WeeklyConfigManager();
    m.submit({ ...selected(), schema_version: "weekly_config.v9" });
    expect(m.resolve(MON, true).reason).toBe("unknown_version");
  });

  it("disables entries for no_deployment", () => {
    const m = new WeeklyConfigManager();
    m.submit(noDeployment());
    expect(m.resolve(MON, true)).toMatchObject({ entriesAllowed: false, reason: "no_deployment" });
  });

  it("keeps protection config for open positions when the artifact goes missing or invalid", () => {
    const m = new WeeklyConfigManager();
    m.submit(selected());
    expect(m.resolve(MON, true).entriesAllowed).toBe(true); // adopted while flat; now a position opens

    m.submit(null);
    const missing = m.resolve(MON, false);
    expect(missing).toMatchObject({ entriesAllowed: false, reason: "missing" });
    expect(missing.protectionConfig?.run_id).toBe("rm9-2026-w47-similarity");

    m.submit({ garbage: true });
    const invalid = m.resolve(MON, false);
    expect(invalid.reason).toBe("invalid");
    expect(invalid.protectionConfig?.run_id).toBe("rm9-2026-w47-similarity");
  });

  it("keeps protection after the week ends while a position is still open", () => {
    const m = new WeeklyConfigManager();
    m.submit(selected());
    m.resolve(FRI, true);
    const r = m.resolve("2026-11-30", false);
    expect(r).toMatchObject({ entriesAllowed: false, reason: "stale" });
    expect(r.protectionConfig).not.toBeNull();
  });

  it("drops the config in force once flat and the artifact is unusable", () => {
    const m = new WeeklyConfigManager();
    m.submit(selected());
    m.resolve(MON, true);
    m.submit(null);
    expect(m.resolve(MON, true).protectionConfig).toBeNull();
    expect(m.activeConfig).toBeNull();
  });

  it("switches configs only while flat", () => {
    const m = new WeeklyConfigManager();
    m.submit(selected());
    expect(m.resolve(MON, true).entriesAllowed).toBe(true);

    const next = selected();
    next.run_id = "rm9-2026-w48-similarity";
    next.activation = { start: "2026-11-30", end: "2026-12-04" };
    m.submit(next);

    // Position still open: the old config keeps protecting, no entries.
    const holding = m.resolve("2026-11-30", false);
    expect(holding).toMatchObject({ entriesAllowed: false, reason: "switch_pending_not_flat" });
    expect(holding.protectionConfig?.run_id).toBe("rm9-2026-w47-similarity");

    // Flat: the new config is adopted and entries open.
    const flat = m.resolve("2026-11-30", true);
    expect(flat.entriesAllowed).toBe(true);
    expect(flat.entryConfig?.run_id).toBe("rm9-2026-w48-similarity");
    expect(m.activeConfig?.run_id).toBe("rm9-2026-w48-similarity");
  });

  it("resubmitting the identical artifact while holding does not block entries", () => {
    const m = new WeeklyConfigManager();
    m.submit(selected());
    m.resolve(MON, true);
    m.submit(selected());
    expect(m.resolve(MON, false).entriesAllowed).toBe(true);
  });

  it("is deterministic: same inputs give the same resolution", () => {
    const a = new WeeklyConfigManager();
    const b = new WeeklyConfigManager();
    a.submit(selected());
    b.submit(selected());
    expect(a.resolve(MON, true)).toEqual(b.resolve(MON, true));
  });
});
