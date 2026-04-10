/**
 * features/backtest/BacktestForm.tsx
 *
 * Form for configuring and launching a backtest run.
 * Collects strategy type, date range, capital, and key parameters.
 *
 * Inputs:  onSubmit callback to trigger the backtest.
 * Outputs: Controlled form; calls onSubmit with BacktestConfig on submission.
 */

"use client";

import { useState } from "react";
import type { BacktestConfig } from "../../types/api";
import { todayString, daysAgoString } from "../../utils/dates";

interface Props {
  onSubmit: (config: Omit<BacktestConfig, "id">) => Promise<void>;
  isLoading?: boolean;
}

export default function BacktestForm({ onSubmit, isLoading }: Props) {
  const [leg1, setLeg1] = useState("SPY");
  const [leg2, setLeg2] = useState("QQQ");
  const [startDate, setStartDate] = useState(daysAgoString(365));
  const [endDate, setEndDate] = useState(daysAgoString(1));
  const [initialCapital, setInitialCapital] = useState(100_000);
  const [entryZScore, setEntryZScore] = useState(2.0);
  const [slippageBps, setSlippageBps] = useState(5);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      name: `${leg1}/${leg2} Pairs Backtest ${startDate} → ${endDate}`,
      strategyConfig: {
        type: "pairs_trading",
        name: `Pairs: ${leg1}/${leg2}`,
        symbols: [leg1, leg2],
        leg1Symbol: leg1,
        leg2Symbol: leg2,
        rollingWindowMs: 3_600_000,
        maxPositionSizeUsd: 10_000,
        cooldownMs: 60_000,
        enabled: true,
        hedgeRatioMethod: "fixed",
        fixedHedgeRatio: 1.0,
        entryZScore,
        exitZScore: 0.5,
        stopLossZScore: 4.0,
        maxHoldingTimeMs: 86_400_000,
        minObservations: 30,
        tradeNotionalUsd: 5_000,
        priceSource: "mid",
      },
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
      initialCapital,
      dataGranularity: "bar",
      slippageBps,
      commissionPerShare: 0.005,
    });
  };

  const inputClass =
    "w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Configure Backtest</h3>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Leg 1", value: leg1, set: (v: string) => setLeg1(v.toUpperCase()) },
          { label: "Leg 2", value: leg2, set: (v: string) => setLeg2(v.toUpperCase()) },
        ].map(({ label, value, set }) => (
          <div key={label} className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500">{label}</label>
            <input type="text" value={value} onChange={(e) => set(e.target.value)} className={inputClass} required />
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500">Start Date</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} required />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500">End Date</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} required />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500">Initial Capital ($)</label>
          <input type="number" min="1000" step="1000" value={initialCapital} onChange={(e) => setInitialCapital(Number(e.target.value))} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500">Entry Z-Score</label>
          <input type="number" min="0.5" max="5" step="0.1" value={entryZScore} onChange={(e) => setEntryZScore(Number(e.target.value))} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-500">Slippage (bps)</label>
          <input type="number" min="0" max="100" step="1" value={slippageBps} onChange={(e) => setSlippageBps(Number(e.target.value))} className={inputClass} />
        </div>
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
