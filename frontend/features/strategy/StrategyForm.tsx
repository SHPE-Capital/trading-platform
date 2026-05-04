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

import { useState, useEffect } from "react";
import type { PairsStrategyConfig } from "../../types/strategy";
import { useStrategyConfigs } from "../../hooks/useStrategyConfigs";

interface Props {
  onSubmit: (config: Omit<PairsStrategyConfig, "id">) => Promise<void>;
  isLoading?: boolean;
}

export default function StrategyForm({ onSubmit, isLoading }: Props) {
  const { strategies, definition, isLoading: configsLoading, save, update } = useStrategyConfigs("pairs_trading");

  const [selectedId, setSelectedId] = useState<string>("new");

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

  // Save UI state
  const [isSavingNew, setIsSavingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

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
    } else {
      const s = strategies.find((s) => s.id === selectedId);
      if (!s) return;
      const c = s.config as Record<string, unknown>;
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
    }
  }, [selectedId, definition, strategies]);

  const buildConfig = (): Omit<PairsStrategyConfig, "id"> => ({
    name,
    type: "pairs_trading",
    leg1Symbol: leg1,
    leg2Symbol: leg2,
    symbols: [leg1, leg2],
    rollingWindowMs: rollingWindowMins * 60_000,
    maxPositionSizeUsd: 10_000,
    cooldownMs: 60_000,
    enabled: true,
    hedgeRatioMethod,
    fixedHedgeRatio: 1,
    entryZScore,
    exitZScore,
    stopLossZScore: 4,
    maxHoldingTimeMs: 86_400_000,
    minObservations: 30,
    tradeNotionalUsd,
    priceSource: "mid",
    olsWindowMs: olsWindowMins * 60_000,
    olsRecalcIntervalBars,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(buildConfig());
  };

  const handleSaveNew = async () => {
    const saveName = newName.trim() || name;
    setSaveError(null);
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
    try {
      await update(selectedId, name, buildConfig() as Record<string, unknown>);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">New Pairs Strategy</h3>

      {/* Strategy type + config picker */}
      <div className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500">Strategy Type</label>
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
              onChange={(e) => { setSelectedId(e.target.value); setIsSavingNew(false); setSaveError(null); }}
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
      </div>

      {/* Config name (shown when an existing strategy is selected) */}
      {selectedId !== "new" && (
        <Field label="Config Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
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
            value={rollingWindowMins}
            onChange={(e) => setRollingWindowMins(Number(e.target.value))}
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
              value={olsWindowMins}
              onChange={(e) => setOlsWindowMins(Number(e.target.value))}
              className={inputClass}
            />
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

      {saveError && (
        <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>
      )}

      {/* Save actions */}
      <div className="flex flex-col gap-2">
        {selectedId !== "new" && (
          <button
            type="button"
            onClick={handleSaveChanges}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Save changes
          </button>
        )}

        {isSavingNew ? (
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={name}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={`${inputClass} flex-1`}
              autoFocus
            />
            <button
              type="button"
              onClick={handleSaveNew}
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900"
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
          {isLoading ? "Starting…" : "Start Strategy"}
        </button>
      </div>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-zinc-500">{label}</label>
      {children}
    </div>
  );
}
