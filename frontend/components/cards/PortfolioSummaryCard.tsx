/**
 * components/cards/PortfolioSummaryCard.tsx
 *
 * Card showing key portfolio metrics at a glance: equity, cash,
 * total PnL, and return percentage. Used on the Dashboard and Portfolio pages.
 *
 * Inputs:  PortfolioSnapshot object.
 * Outputs: Rendered summary card with formatted metrics.
 */

import type { PortfolioSnapshot } from "../../types/portfolio";
import { formatCurrency, formatPercent, pnlColorClass } from "../../utils/formatting";

interface Props {
  snapshot: PortfolioSnapshot;
}

export default function PortfolioSummaryCard({ snapshot }: Props) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
        Portfolio Summary
      </h2>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricItem label="Equity" value={formatCurrency(snapshot.equity)} />
        <MetricItem label="Cash"   value={formatCurrency(snapshot.cash)} />
        <MetricItem
          label="Total PnL"
          value={formatCurrency(snapshot.totalPnl)}
          className={pnlColorClass(snapshot.totalPnl)}
        />
        <MetricItem
          label="Return"
          value={formatPercent(snapshot.returnPct)}
          className={pnlColorClass(snapshot.returnPct)}
        />
      </dl>
    </div>
  );
}

function MetricItem({
  label,
  value,
  className = "text-zinc-900 dark:text-zinc-50",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold tabular-nums ${className}`}>{value}</dd>
    </div>
  );
}
