/**
 * app/dashboard/page.tsx
 *
 * Dashboard page — the primary overview screen.
 * Shows: system health, the account as the broker reports it (equity, cash,
 * history, positions — the source of truth), drift alerts for positions no
 * running strategy manages, and active strategy status cards. A process with
 * no broker connection falls back to the runtime's own book.
 */

"use client";

import { useState, useEffect } from "react";
import SystemHealthCard from "../../components/cards/SystemHealthCard";
import PortfolioSummaryCard from "../../components/cards/PortfolioSummaryCard";
import StrategyStatusCard from "../../components/cards/StrategyStatusCard";
import PnLChart from "../../components/charts/PnLChart";
import BrokerAccountCard from "../../components/cards/BrokerAccountCard";
import DriftBanner from "../../components/cards/DriftBanner";
import BrokerPositionsTable from "../../components/tables/BrokerPositionsTable";
import { useBroker } from "../../hooks/useBroker";
import type { HistoryPeriod } from "../../services/brokerService";
import { usePortfolio } from "../../hooks/usePortfolio";
import { useStrategies } from "../../hooks/useStrategies";
import { useSystemHealth } from "../../hooks/useSystemHealth";
import { useWebSocket } from "../../hooks/useWebSocket";

interface StrategyErrorMsg {
  type: string;
  strategyId: string;
  strategyName?: string;
  error: string;
  phase: string;
}

export default function DashboardPage() {
  const { snapshot, equityCurve, isLoading: portfolioLoading } = usePortfolio();
  const [period, setPeriod] = useState<HistoryPeriod>("1M");
  const broker = useBroker(period);
  const brokerCurve = broker.history.map((h) => ({ ts: h.ts, equity: h.equity }));
  const { runs, error: strategyActionError, stopStrategy } = useStrategies();
  const { status: systemStatus, isLoading: systemLoading } = useSystemHealth();

  const [strategyErrors, setStrategyErrors] = useState<StrategyErrorMsg[]>([]);
  const { lastMessage: wsMsg } = useWebSocket<StrategyErrorMsg>("/ws/events");

  useEffect(() => {
    if (!wsMsg || wsMsg.type !== "STRATEGY_ERROR") return;
    queueMicrotask(() => setStrategyErrors((prev) => [...prev, wsMsg]));
  }, [wsMsg]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Dashboard</h1>

      {strategyActionError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {strategyActionError}
        </div>
      )}

      <DriftBanner rows={broker.drift} />

      {strategyErrors.map((e, i) => (
        <div
          key={i}
          className="mb-4 flex items-start justify-between rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          <span>
            <span className="font-medium">Strategy error</span>
            {" · "}
            <code className="font-mono">{e.strategyName ?? e.strategyId}</code>
            {" · "}phase: {e.phase}
            {" · "}{e.error}
          </span>
          <button
            onClick={() => setStrategyErrors((prev) => prev.filter((_, j) => j !== i))}
            className="ml-4 shrink-0 text-red-400 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      ))}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-1">
          <SystemHealthCard status={systemStatus} isLoading={systemLoading} />

          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-zinc-500">Active Strategies</h2>
            {runs.length === 0 ? (
              <p className="text-sm text-zinc-400">No strategies running.</p>
            ) : (
              runs
                .filter((r) => r.status === "running")
                .map((run) => (
                  <StrategyStatusCard key={run.id} run={run} onStop={stopStrategy} />
                ))
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6 lg:col-span-2">
          {broker.account ? (
            <>
              <BrokerAccountCard account={broker.account} />
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-zinc-500">Account equity</h2>
                  <div className="flex gap-1">
                    {(["1D", "1W", "1M", "3M", "1A"] as HistoryPeriod[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        className={`rounded px-2 py-0.5 text-xs ${p === period ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                      >
                        {p === "1A" ? "1Y" : p}
                      </button>
                    ))}
                  </div>
                </div>
                <PnLChart data={brokerCurve} height={320} />
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Positions</h2>
                <BrokerPositionsTable positions={broker.positions} drift={broker.drift} />
              </div>
            </>
          ) : (
            <>
              {broker.error && <p className="text-xs text-red-500">Broker: {broker.error}</p>}
              {snapshot ? (
                <PortfolioSummaryCard snapshot={snapshot} />
              ) : (
                <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
                  {portfolioLoading || broker.isLoading ? "Loading account…" : "No portfolio data yet."}
                </div>
              )}
              <PnLChart data={equityCurve} height={320} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
