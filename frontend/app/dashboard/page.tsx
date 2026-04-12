/**
 * app/dashboard/page.tsx
 *
 * Dashboard page — the primary overview screen.
 * Shows: system health, live portfolio summary, active strategy status cards,
 * and the equity curve chart.
 *
 * Data: Fetched via usePortfolio and useStrategies hooks.
 * Layout: 2-column grid on desktop, single column on mobile.
 */

"use client";

import SystemHealthCard from "../../components/cards/SystemHealthCard";
import PortfolioSummaryCard from "../../components/cards/PortfolioSummaryCard";
import StrategyStatusCard from "../../components/cards/StrategyStatusCard";
import PnLChart from "../../components/charts/PnLChart";
import { usePortfolio } from "../../hooks/usePortfolio";
import { useStrategies } from "../../hooks/useStrategies";
import { useSystemHealth } from "../../hooks/useSystemHealth";

export default function DashboardPage() {
  const { snapshot, equityCurve, isLoading: portfolioLoading } = usePortfolio();
  const { runs, stopStrategy } = useStrategies();
  const { status: systemStatus, isLoading: systemLoading } = useSystemHealth();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Dashboard</h1>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: health + strategy cards */}
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

        {/* Right column: portfolio summary + equity curve */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          {snapshot ? (
            <PortfolioSummaryCard snapshot={snapshot} />
          ) : (
            <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
              {portfolioLoading ? "Loading portfolio…" : "No portfolio data yet."}
            </div>
          )}
          <PnLChart data={equityCurve} height={320} />
        </div>
      </div>
    </div>
  );
}
