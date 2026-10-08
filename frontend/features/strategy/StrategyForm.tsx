/**
 * features/strategy/StrategyForm.tsx
 *
 * Form for configuring and launching a pairs trading strategy.
 * Users can pick an existing saved config or start from the type's defaults.
 * "Save as new" persists the current form state as a new strategy config.
 * "Save changes" updates the selected existing config (name + fields).
 *
 * Inputs:  onSubmit callback for creating the strategy run.
 * Outputs: Controlled form; calls onSubmit with config on submission.
 */

"use client";

/* Form fields intentionally snapshot the selected persisted configuration. */
 

import { useState, useEffect } from "react";
import type { PairsStrategyConfig, RiskBudget } from "../../types/strategy";
import { useStrategyConfigs } from "../../hooks/useStrategyConfigs";
import { useStrategyVersions } from "../../hooks/useStrategyVersions";
import RiskBudgetSection, { type RiskBudgetState, defaultRiskBudgetState } from "../shared/RiskBudgetSection";
import { createProposal } from "../../services/proposalsService";
import { useAuth } from "../../context/AuthContext";

interface Props {
  onSubmit: (selection: { strategyId: string; versionId: string }) => Promise<void>;
  isLoading?: boolean;
}

export default function StrategyForm({ onSubmit, isLoading }: Props) {
  const { strategies, definition, isLoading: configsLoading, save, update } = useStrategyConfigs("pairs_trading");
  const { user } = useAuth();

  const [selectedId, setSelectedId] = useState<string>("new");

  // Version history for the selected config — who edited it, and when.
  const {
    versions,
    isLoading: versionsLoading,
    refetch: refetchVersions,
  } = useStrategyVersions(selectedId !== "new" ? selectedId : null);
  const [showVersions, setShowVersions] = useState(false);

  // Form fields
  const [name, setName] = useState("Pairs: SPY/QQQ");
  const [leg1, setLeg1] = useState("SPY");
  const [leg2, setLeg2] = useState("QQQ");
  const [entryZScore, setEntryZScore] = useState(2);
  const [exitZScore, setExitZScore] = useState(0.5);
  const [rollingWindowMins, setRollingWindowMins] = useState(60);
  const [tradeNotionalUsd, setTradeNotionalUsd] = useState(5_000);
  const [hedgeRatioMethod, setHedgeRatioMethod] = useState<"fixed" | "rolling_ols">("fixed");
  const [olsWindowMins, setOlsWindowMins] = useState(240);
  const [olsRecalcIntervalBars, setOlsRecalcIntervalBars] = useState(5);
  const [maxHoldingMins, setMaxHoldingMins] = useState(1_440);
  const [cooldownMins, setCooldownMins] = useState(1);

  // Risk budget
  const [riskBudget, setRiskBudget] = useState<RiskBudgetState>(defaultRiskBudgetState);

  const [isSavingNew, setIsSavingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Review workflow: every saved edit becomes an immutable version, and a
  // proposal is how a tested version asks to go live.
  const [changeSummary, setChangeSummary] = useState("");
  const [isProposing, setIsProposing] = useState(false);
  const [proposalTitle, setProposalTitle] = useState("");
  const [proposalNote, setProposalNote] = useState("");
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);

  // Populate fields whenever the selected config changes
  useEffect(() => {
    if (selectedId === "new") {
      if (!definition) return;
      const d = definition.defaultConfig as Record<string, unknown>;
      setName(`Pairs: ${(d.leg1Symbol as string) ?? "SPY"}/${(d.leg2Symbol as string) ?? "QQQ"}`);
      setLeg1((d.leg1Symbol as string | undefined) ?? "SPY");
      setLeg2((d.leg2Symbol as string | undefined) ?? "QQQ");
      setEntryZScore((d.entryZScore as number | undefined) ?? 2);
      setExitZScore((d.exitZScore as number | undefined) ?? 0.5);
      setRollingWindowMins(Math.round(((d.rollingWindowMs as number | undefined) ?? 3_600_000) / 60_000));
      setTradeNotionalUsd((d.tradeNotionalUsd as number | undefined) ?? 5_000);
      setHedgeRatioMethod((d.hedgeRatioMethod as "fixed" | "rolling_ols" | undefined) ?? "fixed");
      setOlsWindowMins(Math.round(((d.olsWindowMs as number | undefined) ?? 14_400_000) / 60_000));
      setOlsRecalcIntervalBars((d.olsRecalcIntervalBars as number | undefined) ?? 5);
      setMaxHoldingMins(Math.round(((d.maxHoldingTimeMs as number | undefined) ?? 86_400_000) / 60_000));
      setCooldownMins(Math.round(((d.cooldownMs as number | undefined) ?? 60_000) / 60_000));
      setRiskBudget(defaultRiskBudgetState);
    } else {
      const s = strategies.find((s) => s.id === selectedId);
      if (!s) return;
      const c = s.config as Record<string, unknown>;
      const rb = c.riskBudget as RiskBudget | undefined;
      setName(s.name);
      setLeg1((c.leg1Symbol as string | undefined) ?? "SPY");
      setLeg2((c.leg2Symbol as string | undefined) ?? "QQQ");
      setEntryZScore((c.entryZScore as number | undefined) ?? 2);
      setExitZScore((c.exitZScore as number | undefined) ?? 0.5);
      setRollingWindowMins(Math.round(((c.rollingWindowMs as number | undefined) ?? 3_600_000) / 60_000));
      setTradeNotionalUsd((c.tradeNotionalUsd as number | undefined) ?? 5_000);
      setHedgeRatioMethod((c.hedgeRatioMethod as "fixed" | "rolling_ols" | undefined) ?? "fixed");
      setOlsWindowMins(Math.round(((c.olsWindowMs as number | undefined) ?? 14_400_000) / 60_000));
      setOlsRecalcIntervalBars((c.olsRecalcIntervalBars as number | undefined) ?? 5);
      setMaxHoldingMins(Math.round(((c.maxHoldingTimeMs as number | undefined) ?? 86_400_000) / 60_000));
      setCooldownMins(Math.round(((c.cooldownMs as number | undefined) ?? 60_000) / 60_000));
      setRiskBudget({
        maxCapitalPct: Math.round((rb?.maxCapitalPct ?? 0.20) * 100),
        maxOpenOrders: rb?.maxOpenOrders ?? null,
        maxOrderNotionalPct: rb?.maxOrderNotionalPct != null
          ? Math.round(rb.maxOrderNotionalPct * 100)
          : null,
      });
    }
  }, [selectedId, definition, strategies]);

  const buildConfig = (): Omit<PairsStrategyConfig, "id"> => {
    const budget: RiskBudget = {
      maxCapitalPct: riskBudget.maxCapitalPct / 100,
      ...(riskBudget.maxOpenOrders !== null && { maxOpenOrders: riskBudget.maxOpenOrders }),
      ...(riskBudget.maxOrderNotionalPct !== null && {
        maxOrderNotionalPct: riskBudget.maxOrderNotionalPct / 100,
      }),
    };
    return {
      name,
      type: "pairs_trading",
      leg1Symbol: leg1,
      leg2Symbol: leg2,
      symbols: [leg1, leg2],
      rollingWindowMs: rollingWindowMins * 60_000,
      maxPositionSizeUsd: 10_000,
      cooldownMs: cooldownMins * 60_000,
      enabled: true,
      hedgeRatioMethod,
      fixedHedgeRatio: 1,
      entryZScore,
      exitZScore,
      stopLossZScore: 4,
      maxHoldingTimeMs: maxHoldingMins * 60_000,
      minObservations: 30,
      tradeNotionalUsd,
      priceSource: "mid",
      olsWindowMs: olsWindowMins * 60_000,
      olsRecalcIntervalBars,
      riskBudget: budget,
    };
  };

  /** Runs the duration guard and surfaces the message. True when safe to proceed. */
  const durationsValid = (): boolean => {
    const err = validateDurations({
      rollingWindowMins, olsWindowMins, maxHoldingMins, cooldownMins, hedgeRatioMethod,
    });
    setSaveError(err);
    return err === null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    if (selectedId === "new") {
      setSaveError("Save this configuration before starting a paper sandbox.");
      return;
    }
    const latest = versions[0];
    if (!latest) {
      setSaveError("This strategy has no saved version to run.");
      return;
    }
    await onSubmit({ strategyId: selectedId, versionId: latest.id });
  };

  const handleSaveNew = async () => {
    const saveName = newName.trim() || name;
    setSaveError(null);
    if (!durationsValid()) return;
    try {
      const created = await save(saveName, buildConfig() as Record<string, unknown>);
      setSelectedId(created.id);
      setIsSavingNew(false);
      setNewName("");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const handleSaveChanges = async () => {
    setSaveError(null);
    setReviewStatus(null);
    if (!durationsValid()) return;
    const config = buildConfig() as Record<string, unknown>;
    try {
      const version = await update(selectedId, name, config, changeSummary.trim() || undefined);
      setChangeSummary("");
      setReviewStatus(version.attachedToProposalId
        ? `Saved as v${version.versionNumber} and attached to the open proposal. Backtest this exact version before approval.`
        : `Saved as v${version.versionNumber}. It is now available for backtest and paper trading.`);
      await refetchVersions();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  };

  /** Opens a promotion request citing this strategy's newest version. */
  const handlePropose = async () => {
    setSaveError(null);
    setReviewStatus(null);
    try {
      const proposal = await createProposal({
        strategyId: selectedId,
        title: proposalTitle.trim() || `Promote ${name}`,
        description: proposalNote.trim() || undefined,
      });
      setIsProposing(false);
      setProposalTitle("");
      setProposalNote("");
      setReviewStatus(`Proposal opened — a lead reviews it in Approvals (${proposal.id.slice(0, 8)}).`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not open proposal");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">New Pairs Strategy</h3>

      {/* Strategy type + config picker */}
      <div className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-zinc-500">Strategy Type</span>
            {definition?.algorithmVersion != null && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                v{definition.algorithmVersion}
              </span>
            )}
          </div>
          <select className={inputClass} value="pairs_trading" disabled>
            <option value="pairs_trading">Pairs Trading</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500">Configuration</label>
          {configsLoading ? (
            <div className="h-8 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
          ) : (
            <select
              className={inputClass}
              value={selectedId}
              onChange={(e) => { setSelectedId(e.target.value); setIsSavingNew(false); setSaveError(null); setShowVersions(false); }}
            >
              <option value="new">New Configuration</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Config name editor — inside the picker box */}
        {selectedId !== "new" && !isSavingNew && (
          <Field label="Config Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </Field>
        )}

        {/* New config name — inside the picker box when saving as new */}
        {isSavingNew && (
          <Field label="New Config Name">
            <input
              type="text"
              placeholder={name}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={inputClass}
              autoFocus
            />
          </Field>
        )}

        {/* Version history — who edited this config, and when */}
        {selectedId !== "new" && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setShowVersions((v) => !v)}
              className="self-start text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              {showVersions ? "Hide" : "Show"} version history
              {versions.length > 0 ? ` (${versions.length})` : ""}
            </button>
            {showVersions && (
              <div className="flex flex-col gap-1 rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
                {versionsLoading ? (
                  <p className="text-xs text-zinc-400">Loading…</p>
                ) : versions.length === 0 ? (
                  <p className="text-xs text-zinc-400">No versions yet.</p>
                ) : (
                  versions.map((v) => (
                    <div key={v.id} className="flex flex-col gap-0.5 border-b border-zinc-100 py-1 text-xs last:border-0 dark:border-zinc-800">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">v{v.versionNumber}</span>
                        <span className="text-zinc-400">{new Date(v.createdAt).toLocaleString()}</span>
                      </div>
                      <span className="text-zinc-500">
                        {v.createdByName ?? "Unknown"}
                        {v.changeSummary ? ` — ${v.changeSummary}` : ""}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
        <Field label="Leg 1 Symbol">
          <input
            type="text"
            value={leg1}
            onChange={(e) => setLeg1(e.target.value.toUpperCase())}
            className={inputClass}
            required
          />
        </Field>
        <Field label="Leg 2 Symbol">
          <input
            type="text"
            value={leg2}
            onChange={(e) => setLeg2(e.target.value.toUpperCase())}
            className={inputClass}
            required
          />
        </Field>
        <Field label="Entry Z-Score">
          <input
            type="number"
            step="0.1"
            min="0.5"
            max="5"
            value={entryZScore}
            onChange={(e) => setEntryZScore(Number(e.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label="Exit Z-Score">
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={exitZScore}
            onChange={(e) => setExitZScore(Number(e.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label="Spread Window (minutes)">
          <input
            type="number"
            step="5"
            min="5"
            max={MAX_WINDOW_MINS}
            value={rollingWindowMins}
            onChange={(e) => setRollingWindowMins(Number(e.target.value))}
            className={inputClass}
          />
          <FieldHint>{describeMinutes(rollingWindowMins)}</FieldHint>
        </Field>
        <Field label="Max Holding Time (minutes)">
          <input
            type="number"
            step="1"
            min="1"
            max={MAX_WINDOW_MINS}
            value={maxHoldingMins}
            onChange={(e) => setMaxHoldingMins(Number(e.target.value))}
            className={inputClass}
          />
          <FieldHint>{describeMinutes(maxHoldingMins)} — force-exit if the spread has not reverted</FieldHint>
        </Field>
        <Field label="Cooldown After Exit (minutes)">
          <input
            type="number"
            step="1"
            min="0"
            max={MAX_WINDOW_MINS}
            value={cooldownMins}
            onChange={(e) => setCooldownMins(Number(e.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label="Trade Notional (USD)">
          <input
            type="number"
            step="100"
            min="100"
            value={tradeNotionalUsd}
            onChange={(e) => setTradeNotionalUsd(Number(e.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label="Hedge Ratio Method">
          <select
            value={hedgeRatioMethod}
            onChange={(e) => setHedgeRatioMethod(e.target.value as "fixed" | "rolling_ols")}
            className={inputClass}
          >
            <option value="fixed">Fixed (1:1)</option>
            <option value="rolling_ols">Rolling OLS</option>
          </select>
        </Field>
      </div>

      {hedgeRatioMethod === "rolling_ols" && (
        <div className="grid grid-cols-2 gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
          <p className="col-span-2 text-xs text-zinc-500">
            OLS estimates the hedge ratio by regressing leg 1 on leg 2 over the window below.
            Use a window 2–4× longer than the spread window for a stable ratio.
          </p>
          <Field label="OLS Window (minutes)">
            <input
              type="number"
              step="30"
              min="30"
              max={MAX_WINDOW_MINS}
              value={olsWindowMins}
              onChange={(e) => setOlsWindowMins(Number(e.target.value))}
              className={inputClass}
            />
            <FieldHint>{describeMinutes(olsWindowMins)}</FieldHint>
          </Field>
          <Field label="Recalc Every N Bars">
            <input
              type="number"
              step="1"
              min="1"
              max="60"
              value={olsRecalcIntervalBars}
              onChange={(e) => setOlsRecalcIntervalBars(Number(e.target.value))}
              className={inputClass}
            />
          </Field>
        </div>
      )}

      {/* Portfolio Allocation */}
      <div className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Portfolio Allocation</p>
        <RiskBudgetSection value={riskBudget} onChange={setRiskBudget} />
      </div>

      {saveError && (
        <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>
      )}

      {reviewStatus && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {reviewStatus}
        </p>
      )}

      {/* Save actions */}
      <div className="flex flex-col gap-2">
        {selectedId !== "new" && (
          <>
            <Field label="What changed? (saved with this version)">
              <input
                id="change-summary"
                type="text"
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                placeholder="e.g. widened spread window to 7 days"
                className={inputClass}
              />
            </Field>
            <button
              type="button"
              onClick={handleSaveChanges}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Save changes
            </button>

            {user && (isProposing ? (
              <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
                <p className="text-xs text-zinc-500">
                  Proposes the newest saved version for a lead to review.
                </p>
                <input
                  id="proposal-title"
                  type="text"
                  value={proposalTitle}
                  onChange={(e) => setProposalTitle(e.target.value)}
                  placeholder={`Promote ${name}`}
                  className={inputClass}
                />
                <textarea
                  id="proposal-note"
                  rows={3}
                  value={proposalNote}
                  onChange={(e) => setProposalNote(e.target.value)}
                  placeholder="Why should this go live? Which backtests back it?"
                  className={inputClass}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handlePropose}
                    className="flex-1 rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900"
                  >
                    Open proposal
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsProposing(false); setSaveError(null); }}
                    className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsProposing(true)}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Propose for live review
              </button>
            ))}
          </>
        )}

        {isSavingNew ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveNew}
              className="flex-1 rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => { setIsSavingNew(false); setNewName(""); setSaveError(null); }}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-700"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsSavingNew(true)}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Save as new configuration
          </button>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {isLoading ? "Starting…" : "Start Latest Saved Version on Paper"}
        </button>
      </div>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

/**
 * Upper bound for any duration field, in minutes (~1 year).
 *
 * These inputs are in MINUTES but the backend config is in MILLISECONDS, so
 * pasting a millisecond value into one of them silently produces a window
 * 60,000x too large. That happened in production: a 604,800,000 entry became a
 * 1,150-year window, which disabled rolling-window eviction entirely and turned
 * the z-score into an O(n) scan over the whole backtest.
 */
const MAX_WINDOW_MINS = 527_040;

/** Renders a minutes count as a human-scale duration so mis-typed values stand out. */
function describeMinutes(mins: number): string {
  if (!Number.isFinite(mins) || mins <= 0) return "—";
  if (mins < 60) return `${mins} min`;
  if (mins < 1_440) return `${(mins / 60).toFixed(1).replace(/\.0$/, "")} hours`;
  if (mins < 43_200) return `${(mins / 1_440).toFixed(1).replace(/\.0$/, "")} days`;
  return `${(mins / 43_200).toFixed(1).replace(/\.0$/, "")} months`;
}

/**
 * Validates every duration field before submit. Returns an error message, or
 * null when all values are sane.
 */
function validateDurations(v: {
  rollingWindowMins: number;
  olsWindowMins: number;
  maxHoldingMins: number;
  cooldownMins: number;
  hedgeRatioMethod: string;
}): string | null {
  const fields: Array<[string, number, number]> = [
    ["Spread Window", v.rollingWindowMins, 5],
    ["Max Holding Time", v.maxHoldingMins, 1],
    ["Cooldown After Exit", v.cooldownMins, 0],
  ];
  if (v.hedgeRatioMethod === "rolling_ols") {
    fields.push(["OLS Window", v.olsWindowMins, 30]);
  }

  for (const [label, value, min] of fields) {
    if (!Number.isFinite(value)) return `${label} must be a number.`;
    if (value < min) return `${label} must be at least ${min} minutes.`;
    if (value > MAX_WINDOW_MINS) {
      return `${label} of ${value.toLocaleString()} minutes is about ${describeMinutes(value)}. ` +
        `These fields are in minutes, not milliseconds — the maximum is ${MAX_WINDOW_MINS.toLocaleString()} (1 year).`;
    }
  }

  if (v.hedgeRatioMethod === "rolling_ols" && v.olsWindowMins <= v.rollingWindowMins) {
    return "OLS Window should be longer than the Spread Window so the hedge ratio stays stable across spread cycles.";
  }
  return null;
}

/** Small caption under an input. */
function FieldHint({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] text-zinc-400">{children}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-zinc-500">{label}</label>
      {children}
    </div>
  );
}
