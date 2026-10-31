import { describe, expect, it } from "vitest";
import { describeFills, describeMarketData, runDataLabel } from "../../utils/marketData";
import type { MarketDataStatus } from "../../types/api";

const status = (over: Partial<MarketDataStatus> = {}): MarketDataStatus => ({
  source: "alpaca-stream", feed: "iex", state: "live", connected: true, subscribedSymbols: 2,
  lastBarAt: 0, staleAfterMs: 180_000, message: "Live bars from Alpaca (IEX).", ...over,
});

describe("describeMarketData", () => {
  it.each([
    ["live", "Live · IEX", "ok"],
    ["idle", "Idle · IEX", "neutral"],
    ["market_closed", "Market closed", "neutral"],
    ["stale", "Stale data", "warn"],
    ["disconnected", "Disconnected", "error"],
    ["no_data", "No data", "error"],
  ] as const)("%s -> %s (%s)", (state, label, tone) => {
    expect(describeMarketData(status({ state }))).toMatchObject({ label, tone });
  });

  it("explains the IEX/SIP gap in the tooltip for the free feed", () => {
    expect(describeMarketData(status())!.title).toMatch(/IEX[\s\S]*SIP/);
    expect(describeMarketData(status({ feed: "sip" }))!.title).not.toMatch(/IEX only/);
  });

  it("returns null when the backend reports no engine", () => {
    expect(describeMarketData(null)).toBeNull();
    expect(describeMarketData(undefined)).toBeNull();
  });
});

describe("describeFills", () => {
  it.each([
    [{ target: "sim", brokerAccount: "sim:laptop" }, "Fills: simulator"],
    [{ target: "alpaca-paper", brokerAccount: "PA123" }, "Fills: Alpaca paper (PA123)"],
    [{ target: "alpaca-live", brokerAccount: "123" }, "Fills: Alpaca LIVE (123)"],
  ])("%o -> %s", (execution, label) => {
    expect(describeFills(execution)).toBe(label);
  });

  it("can leave the account number out", () => {
    expect(describeFills({ target: "alpaca-paper", brokerAccount: "PA123" }, false)).toBe("Fills: Alpaca paper");
  });

  it("returns null without an execution target", () => {
    expect(describeFills({ target: null, brokerAccount: null })).toBeNull();
    expect(describeFills(undefined)).toBeNull();
  });
});

describe("runDataLabel", () => {
  it("labels a run by the data it traded on", () => {
    expect(runDataLabel({ marketData: { source: "alpaca-stream", feed: "iex" } })).toBe("data: Alpaca IEX");
    expect(runDataLabel({ marketData: { source: "none", feed: null } })).toBe("data: none");
  });

  it("returns null for runs from before the data source was recorded", () => {
    expect(runDataLabel({ sandbox: true })).toBeNull();
    expect(runDataLabel(undefined)).toBeNull();
  });
});
