/**
 * features/portfolio/PortfolioMetrics.tsx
 *
 * Detailed portfolio metrics panel combining summary card, positions table,
 * orders table, fills table, and equity curve chart in a tabbed layout.
 *
 * Inputs:  PortfolioSnapshot, equity curve, and orders from hooks.
 * Outputs: Full portfolio metrics view with tabs for different data.
 */

"use client";

import { useState } from "react";
import PortfolioSummaryCard from "../../components/cards/PortfolioSummaryCard";
import PositionsTable from "../../components/tables/PositionsTable";
import OrdersTable from "../../components/tables/OrdersTable";
import FillsTable from "../../components/tables/FillsTable";
import PnLChart from "../../components/charts/PnLChart";
import { usePortfolio } from "../../hooks/usePortfolio";

const TABS = ["Overview", "Positions", "Orders", "Fills"] as const;
type Tab = (typeof TABS)[number];

export default function PortfolioMetrics() {
  const { snapshot, equityCurve, isLoading, error } = usePortfolio();
  const [activeTab, setActiveTab] = useState<Tab>("Overview");

  if (isLoading) return <p className="text-sm text-zinc-400">Loading portfolio…</p>;
  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (!snapshot) return <p className="text-sm text-zinc-400">No portfolio data available.</p>;

  const allFills = snapshot.positions.flatMap(() => []);

  return (
    <div className="flex flex-col gap-6">
      <PortfolioSummaryCard snapshot={snapshot} />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              "px-4 py-2 text-sm font-medium transition-colors",
              activeTab === tab
                ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
            ].join(" ")}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Overview"   && <PnLChart data={equityCurve} height={300} />}
      {activeTab === "Positions"  && <PositionsTable positions={snapshot.positions} />}
      {activeTab === "Orders"     && <OrdersTable orders={[]} />}
      {activeTab === "Fills"      && <FillsTable fills={allFills} />}
    </div>
  );
}
