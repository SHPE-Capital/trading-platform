/**
 * features/backtest/BacktestForm.tsx
 *
 * Form for configuring and launching a backtest run.
 * Shows the full strategy config (same fields as StrategyForm) plus the
 * backtest-specific extras: date range, initial capital, and slippage.
 * Picking a saved config populates all strategy fields; they remain
 * editable before submitting.
 *
 * Inputs:  onSubmit callback to trigger the backtest.
 * Outputs: Controlled form; calls onSubmit with BacktestConfig on submission.
 */

"use client";

import { useState, useEffect } from "react";
import type { BacktestConfig } from "../../types/api";
import { useStrategyConfigs } from "../../hooks/useStrategyConfigs";
import { daysAgoString } from "../../utils/dates";

interface Props {
  onSubmit: (config: Omit<BacktestConfig, "id">) => Promise<void>;
  isLoading?: boolean;
}

export default function BacktestForm({ onSubmit, isLoading }: Props) {
  const { strategies, definition, isLoading: configsLoading } = useStrategyConfigs("pairs_trading");

  const [selectedId, setSelectedId] = useState<string>("new");

  // Strategy config fields (mirrors StrategyForm)
  const [leg1, setLeg1] = useState("SPY");
  const [leg2, setLeg2] = useState("QQQ");
  const [entryZScore, setEntryZScore] = useState(2.0);
  const [exitZScore, setExitZScore] = useState(0.5);
  const [rollingWindowMins, setRollingWindowMins] = useState(60);
  const [tradeNotionalUsd, setTradeNotionalUsd] = useState(5_000);
  const [hedgeRatioMethod, setHedgeRatioMethod] = useState<"fixed" | "rolling_ols">("fixed");
  const [olsWindowMins, setOlsWindowMins] = useState(240);
  const [olsRecalcIntervalBars, setOlsRecalcIntervalBars] = useState(5);

  // Backtest-specific extras
  const [startDate, setStartDate] = useState(daysAgoString(365));
  const [endDate, setEndDate] = useState(daysAgoString(1));
  const [initialCapital, setInitialCapital] = useState(100_000);
  const [slippageBps, setSlippageBps] = useState(5);

  // Populate strategy fields whenever the selected config changes
  useEffect(() => {
    const src: Record<string, unknown> =
      selectedId === "new"
        ? (definition?.defaultConfig ?? {})
        : (strategies.find((s) => s.id === selectedId)?.config ?? {});

    if (Object.keys(src).length === 0) return;

    setLeg1((src.leg1Symbol as string | undefined) ?? "SPY");
    setLeg2((src.leg2Symbol as string | undefined) ?? "QQQ");
    setEntryZScore((src.entryZScore as number | undefined) ?? 2.0);
    setExitZScore((src.exitZScore as number | undefined) ?? 0.5);
    setRollingWindowMins(Math.round(((src.rollingWindowMs as number | undefined) ?? 3_600_000) / 60_000));
    setTradeNotionalUsd((src.tradeNotionalUsd as number | undefined) ?? 5_000);
    setHedgeRatioMethod((src.hedgeRatioMethod as "fixed" | "rolling_ols" | undefined) ?? "fixed");
    setOlsWindowMins(Math.round(((src.olsWindowMs as number | undefined) ?? 14_400_000) / 60_000));
    setOlsRecalcIntervalBars((src.olsRecalcIntervalBars as number | undefined) ?? 5);
  }, [selectedId, definition, strategies]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedStrategy = strategies.find((s) => s.id === selectedId);
    await onSubmit({
      name: `${leg1}/${leg2} Pairs Backtest ${startDate} → ${endDate}`,
      strategyConfig: {
        type: "pairs_trading",
        name: `Pairs: ${leg1}/${leg2}`,
        symbols: [leg1, leg2],
        leg1Symbol: leg1,
        leg2Symbol: leg2,
        rollingWindowMs: rollingWindowMins * 60_000,
        maxPositionSizeUsd: 10_000,
        cooldownMs: 60_000,
        enabled: true,
        hedgeRatioMethod,
        fixedHedgeRatio: 1.0,
        entryZScore,
        exitZScore,
        stopLossZScore: 4.0,
        maxHoldingTimeMs: 86_400_000,
        minObservations: 30,
        tradeNotionalUsd,
        priceSource: "mid",
        olsWindowMs: olsWindowMins * 60_000,
        olsRecalcIntervalBars,
      },
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
      initialCapital,
      dataGranularity: "bar",
      slippageBps,
      commissionPerShare: 0.005,
      strategyId: selectedStrategy?.id,
      strategyVersion: selectedStrategy?.version,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Configure Backtest</h3>

      {/* Strategy type + config picker */}
      <div className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
        <Field label="Strategy Type">
          <select className={inputClass} value="pairs_trading" disabled>
            <option value="pairs_trading">Pairs Trading</option>
          </select>
        </Field>
        <Field label="Configuration">
          {configsLoading ? (
            <div className="h-8 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
          ) : (
            <select
              className={inputClass}
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              <option value="new">New Configuration</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </Field>
      </div>

      {/* Strategy config fields */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Leg 1">
          <input type="text" value={leg1} onChange={(e) => setLeg1(e.target.value.toUpperCase())} className={inputClass} required />
        </Field>
        <Field label="Leg 2">
          <input type="text" value={leg2} onChange={(e) => setLeg2(e.target.value.toUpperCase())} className={inputClass} required />
        </Field>
        <Field label="Entry Z-Score">
          <input type="number" min="0.5" max="5" step="0.1" value={entryZScore} onChange={(e) => setEntryZScore(Number(e.target.value))} className={inputClass} />
        </Field>
        <Field label="Exit Z-Score">
          <input type="number" min="0" max="2" step="0.1" value={exitZScore} onChange={(e) => setExitZScore(Number(e.target.value))} className={inputClass} />
        </Field>
        <Field label="Spread Window (minutes)">
          <input type="number" min="5" step="5" value={rollingWindowMins} onChange={(e) => setRollingWindowMins(Number(e.target.value))} className={inputClass} />
        </Field>
        <Field label="Trade Notional (USD)">
          <input type="number" min="100" step="100" value={tradeNotionalUsd} onChange={(e) => setTradeNotionalUsd(Number(e.target.value))} className={inputClass} />
        </Field>
        <Field label="Hedge Ratio Method">
          <select value={hedgeRatioMethod} onChange={(e) => setHedgeRatioMethod(e.target.value as "fixed" | "rolling_ols")} className={inputClass}>
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
            <input type="number" min="30" step="30" value={olsWindowMins} onChange={(e) => setOlsWindowMins(Number(e.target.value))} className={inputClass} />
          </Field>
          <Field label="Recalc Every N Bars">
            <input type="number" min="1" max="60" step="1" value={olsRecalcIntervalBars} onChange={(e) => setOlsRecalcIntervalBars(Number(e.target.value))} className={inputClass} />
          </Field>
        </div>
      )}

      {/* Backtest-specific extras */}
      <div className="grid grid-cols-2 gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
        <Field label="Start Date">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} required />
        </Field>
        <Field label="End Date">
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Initial Capital ($)">
          <input type="number" min="1000" step="1000" value={initialCapital} onChange={(e) => setInitialCapital(Number(e.target.value))} className={inputClass} />
        </Field>
        <Field label="Slippage (bps)">
          <input type="number" min="0" max="100" step="1" value={slippageBps} onChange={(e) => setSlippageBps(Number(e.target.value))} className={inputClass} />
        </Field>
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {isLoading ? "Queuing…" : "Run Backtest"}
      </button>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-zinc-500">{label}</label>
      {children}
    </div>
  );
}
