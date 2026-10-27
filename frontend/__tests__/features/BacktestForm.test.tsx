import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The form re-populates its fields in an effect keyed on `strategies` and
// `definition`, so the mocks hand back the same objects on every render.
const configs = vi.hoisted(() => ({
  strategies: [] as unknown[],
  definition: { algorithmVersion: 5, defaultConfig: { leg1Symbol: "SPY", leg2Symbol: "QQQ" } },
  versions: [] as unknown[],
  generic: {
    type: "momentum", label: "Prototype", algorithmVersion: 1, status: "experimental",
    actions: { save: { allowed: true }, backtest: { allowed: true }, startTrading: { allowed: false } },
    defaultConfig: { name: "Prototype", symbols: ["SPY"], qtyPerTrade: 1 },
    params: [{ key: "symbols", label: "Symbols", kind: "symbols" }, { key: "qtyPerTrade", label: "Shares per trade", kind: "number", min: 1 }],
  },
}));

vi.mock("../../hooks/useStrategyTypes", () => ({
  useStrategyTypes: () => ({ types: [{ type: "pairs_trading", label: "Pairs Trading", actions: { backtest: { allowed: true } } }, configs.generic], isLoading: false }),
}));
vi.mock("../../hooks/useStrategyConfigs", () => ({
  useStrategyConfigs: (type: string) => ({ strategies: configs.strategies, definition: type === "momentum" ? configs.generic : configs.definition, isLoading: false }),
}));
vi.mock("../../hooks/useStrategyVersions", () => ({
  useStrategyVersions: () => ({ versions: configs.versions, isLoading: false }),
}));

import BacktestForm from "../../features/backtest/BacktestForm";
import type { BacktestConfig } from "../../types/api";

const submitted = () => vi.fn<(config: Omit<BacktestConfig, "id">) => Promise<void>>(async () => {});

beforeEach(() => { vi.clearAllMocks(); configs.strategies = []; configs.versions = []; });

describe("BacktestForm fills", () => {
  it("leaves the execution model to the server by default (next bar's open)", async () => {
    const onSubmit = submitted();
    render(<BacktestForm onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Run Backtest" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("execution");
  });

  it("asks for quote fills with the chosen latency", async () => {
    const onSubmit = submitted();
    render(<BacktestForm onSubmit={onSubmit} />);
    // The form's labels sit beside their controls, so controls are found by what they show.
    await userEvent.selectOptions(screen.getByDisplayValue("Next bar's open"), "quote");
    const latency = screen.getByDisplayValue("250");
    await userEvent.clear(latency);
    await userEvent.type(latency, "400");
    await userEvent.click(screen.getByRole("button", { name: "Run Backtest" }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ execution: { model: "quote", latencyMs: 400 } });
  });
});


describe("catalog backtesting", () => {
  it("tags an unchanged saved version and drops the tag after parameter edits", async () => {
    configs.strategies = [{ id: "cfg-1", name: "Saved prototype", strategy_type: "momentum", config: {
      ...configs.generic.defaultConfig, riskBudget: { maxCapitalPct: 0.2 },
    } }];
    configs.versions = [{ id: "version-1" }];
    const onSubmit = submitted();
    render(<BacktestForm onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Strategy Type" }), "momentum");
    await userEvent.selectOptions(screen.getByDisplayValue("New Configuration"), "cfg-1");
    await userEvent.click(screen.getByRole("button", { name: "Run Backtest" }));
    expect(onSubmit.mock.calls[0][0].strategyVersionId).toBe("version-1");
    await userEvent.clear(screen.getByLabelText("Shares per trade"));
    await userEvent.type(screen.getByLabelText("Shares per trade"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Run Backtest" }));
    expect(onSubmit.mock.calls[1][0].strategyVersionId).toBeUndefined();
  });

  it("backtests an experimental strategy using its generic parameters", async () => {
    const onSubmit = submitted();
    render(<BacktestForm onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Strategy Type" }), "momentum");
    await userEvent.clear(screen.getByLabelText("Symbols"));
    await userEvent.type(screen.getByLabelText("Symbols"), "AAPL, MSFT");
    await userEvent.clear(screen.getByLabelText("Shares per trade"));
    await userEvent.type(screen.getByLabelText("Shares per trade"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Run Backtest" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].strategyConfig).toMatchObject({ type: "momentum", symbols: ["AAPL", "MSFT"], qtyPerTrade: 3 });
    expect(onSubmit.mock.calls[0][0].strategyConfig).not.toHaveProperty("leg1Symbol");
    expect(onSubmit.mock.calls[0][0].name).toContain("Prototype Backtest");
  });
});
