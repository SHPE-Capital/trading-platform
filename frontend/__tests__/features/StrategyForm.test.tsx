import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "m@shpe.test", role: "member", displayName: "M" } as unknown }));

// The form re-populates its fields in an effect keyed on `strategies` and
// `definition`. The real hook returns stable state, so the mock must hand back
// the SAME objects every render — fresh literals would re-run that effect on
// every render and never settle.
const configs = vi.hoisted(() => ({
  update: vi.fn(async () => ({ id: "ver-2", versionNumber: 2, attachedToProposalId: null as string | null })),
  save: vi.fn(async () => ({ id: "strat-new" })),
  strategies: [
    {
      id: "strat-1",
      name: "Pairs: XOM/CVX",
      strategy_type: "pairs_trading",
      config: { leg1Symbol: "XOM", leg2Symbol: "CVX", entryZScore: 2, rollingWindowMs: 3_600_000 },
    },
  ],
  definition: { algorithmVersion: 4, defaultConfig: { leg1Symbol: "SPY", leg2Symbol: "QQQ" } },
  remove: vi.fn(),
  refetch: vi.fn(),
}));

const versions = vi.hoisted(() => ({
  list: [] as unknown[],
  none: [] as unknown[],
  refetch: vi.fn(async () => {}),
}));

vi.mock("../../context/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("../../hooks/useStrategyConfigs", () => ({
  useStrategyConfigs: () => ({
    strategies: configs.strategies,
    definition: configs.definition,
    isLoading: false,
    error: null,
    save: configs.save,
    update: configs.update,
    remove: configs.remove,
    refetch: configs.refetch,
  }),
}));
vi.mock("../../hooks/useStrategyVersions", () => ({
  useStrategyVersions: (id: string | null) => ({
    versions: id ? versions.list : versions.none,
    isLoading: false,
    error: null,
    refetch: versions.refetch,
  }),
}));
vi.mock("../../services/proposalsService", () => ({
  createProposal: vi.fn(),
}));

import StrategyForm from "../../features/strategy/StrategyForm";
import { createProposal } from "../../services/proposalsService";

const mockCreateProposal = vi.mocked(createProposal);

async function selectSavedConfig(onSubmit = vi.fn(async () => {})) {
  render(<StrategyForm onSubmit={onSubmit} />);
  await userEvent.selectOptions(screen.getAllByRole("combobox")[1], "strat-1");
}

beforeEach(() => {
  versions.list = [];
  configs.update.mockResolvedValue({ id: "ver-2", versionNumber: 2, attachedToProposalId: null });
});

describe("StrategyForm — versions and proposals", () => {
  it("'Save changes' updates the config and records the edit as an immutable version", async () => {
    await selectSavedConfig();

    await userEvent.type(screen.getByPlaceholderText(/widened spread window/), "tighter entry");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(configs.update).toHaveBeenCalled());
    expect(configs.update).toHaveBeenCalledWith(
      "strat-1",
      "Pairs: XOM/CVX",
      expect.objectContaining({ leg1Symbol: "XOM" }),
      "tighter entry",
    );
    expect(versions.refetch).toHaveBeenCalled();
    expect(await screen.findByText(/Saved as v2\. It is now available for backtest and paper trading/)).toBeInTheDocument();
  });

  it("starts paper trading with the exact latest saved version", async () => {
    const onSubmit = vi.fn(async () => {});
    versions.list = [{ id: "ver-3", versionNumber: 3 }];
    await selectSavedConfig(onSubmit);

    fireEvent.submit(screen.getByRole("button", { name: "Start Latest Saved Version on Paper" }).closest("form")!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ strategyId: "strat-1", versionId: "ver-3" });
    });
  });

  it("tells the author when the saved version advances an open proposal", async () => {
    configs.update.mockResolvedValue({ id: "ver-3", versionNumber: 3, attachedToProposalId: "p1" });
    await selectSavedConfig();

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(/Saved as v3 and attached to the open proposal/)).toBeInTheDocument();
  });

  it("'Propose for live review' opens a proposal for the selected strategy", async () => {
    mockCreateProposal.mockResolvedValue({ id: "prop-12345678" } as never);
    await selectSavedConfig();

    await userEvent.click(screen.getByRole("button", { name: "Propose for live review" }));
    await userEvent.type(screen.getByPlaceholderText(/Why should this go live/), "Clean on 5 backtests");
    await userEvent.click(screen.getByRole("button", { name: "Open proposal" }));

    await waitFor(() => expect(mockCreateProposal).toHaveBeenCalled());
    expect(mockCreateProposal).toHaveBeenCalledWith({
      strategyId: "strat-1",
      title: "Promote Pairs: XOM/CVX",
      description: "Clean on 5 backtests",
    });
    expect(await screen.findByText(/Proposal opened/)).toBeInTheDocument();
  });

  it("surfaces the backend's refusal when a proposal cannot be opened", async () => {
    mockCreateProposal.mockRejectedValue(new Error("This strategy already has an open proposal"));
    await selectSavedConfig();

    await userEvent.click(screen.getByRole("button", { name: "Propose for live review" }));
    await userEvent.click(screen.getByRole("button", { name: "Open proposal" }));

    expect(await screen.findByText("This strategy already has an open proposal")).toBeInTheDocument();
  });

  it("shows each version with its author and change summary", async () => {
    versions.list = [
      { id: "ver-2", versionNumber: 2, createdAt: Date.now(), createdByName: "Ana", changeSummary: "wider window" },
      { id: "ver-1", versionNumber: 1, createdAt: Date.now() - 86_400_000, createdByName: "Luis", changeSummary: "Initial version" },
    ];
    await selectSavedConfig();

    await userEvent.click(screen.getByRole("button", { name: /Show version history \(2\)/ }));

    expect(screen.getByText("Ana — wider window")).toBeInTheDocument();
    expect(screen.getByText("Luis — Initial version")).toBeInTheDocument();
  });

  it("offers no version or proposal actions for an unsaved configuration", () => {
    render(<StrategyForm onSubmit={vi.fn(async () => {})} />);
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Propose for live review" })).not.toBeInTheDocument();
  });
});
