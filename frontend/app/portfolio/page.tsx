/**
 * app/portfolio/page.tsx
 *
 * Portfolio overview page.
 * Shows current snapshot metrics, open positions, recent orders, and fills.
 *
 * Data:    usePortfolio hook for snapshot, positions, orders, fills.
 * Layout:  Full-width PortfolioMetrics feature component.
 */

"use client";

import PortfolioMetrics from "../../features/PortfolioMetrics";
import { usePortfolio } from "../../hooks/usePortfolio";

export default function PortfolioPage() {
  const { snapshot, isLoading } = usePortfolio();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Portfolio</h1>

      {isLoading ? (
        <p className="text-sm text-zinc-400">Loading portfolio…</p>
      ) : (
        <PortfolioMetrics snapshot={snapshot} />
      )}
    </div>
  );
}
