/**
 * features/strategy/StrategyForm.tsx
 *
 * Form for configuring and launching a pairs trading strategy.
 * Collects all required PairsStrategyConfig fields and calls the
 * startStrategy callback on submission.
 *
 * Inputs:  onSubmit callback for creating the strategy run.
 * Outputs: Controlled form rendering with validation; calls onSubmit with config.
 */

"use client";

import { useState } from "react";
import type { PairsStrategyConfig } from "../../types/strategy";

interface Props {
  onSubmit: (config: Omit<PairsStrategyConfig, "id">) => Promise<void>;
  isLoading?: boolean;
}

export default function StrategyForm({ onSubmit, isLoading }: Props) {
  const [leg1, setLeg1] = useState("SPY");
  const [leg2, setLeg2] = useState("QQQ");
  const [entryZScore, setEntryZScore] = useState(2);
  const [exitZScore, setExitZScore] = useState(0.5);
  const [rollingWindowMins, setRollingWindowMins] = useState(60);
  const [tradeNotionalUsd, setTradeNotionalUsd] = useState(5_000);
  const [hedgeRatioMethod, setHedgeRatioMethod] = useState<"fixed" | "rolling_ols">("fixed");
  const [olsWindowMins, setOlsWindowMins] = useState(240);
  const [olsRecalcIntervalBars, setOlsRecalcIntervalBars] = useState(5);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      name: `Pairs: ${leg1}/${leg2}`,
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
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">New Pairs Strategy</h3>

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

      <button
        type="submit"
        disabled={isLoading}
        className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {isLoading ? "Starting…" : "Start Strategy"}
      </button>
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
