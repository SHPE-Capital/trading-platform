/**
 * components/cards/StrategyStatusCard.tsx
 *
 * Card showing the current status and key metrics for a single strategy run.
 * Used on the Dashboard and Strategy Management pages.
 *
 * Inputs:  StrategyRun object.
 * Outputs: Rendered status card with run state badge, signal/order counts, and PnL.
 */

import type { StrategyRun } from "../../types/strategy";
import { formatCurrency } from "../../utils/formatting";

interface Props {
  run: StrategyRun;
  onStop?: (id: string) => void;
}

const STATUS_BADGE: Record<string, string> = {
  idle:    "bg-zinc-100 text-zinc-600",
  running: "bg-green-100 text-green-700",
  paused:  "bg-yellow-100 text-yellow-700",
  stopped: "bg-zinc-100 text-zinc-500",
  error:   "bg-red-100 text-red-700",
};

export default function StrategyStatusCard({ run, onStop }: Props) {
  const badgeClass = STATUS_BADGE[run.status] ?? STATUS_BADGE["idle"];

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{run.name}</p>
          <p className="text-xs text-zinc-400">{run.strategyType}</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${badgeClass}`}>
          {run.status}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
        <div>
          <dt className="text-zinc-500">Signals</dt>
          <dd className="font-semibold text-zinc-900 dark:text-zinc-50">{run.totalSignals}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Orders</dt>
          <dd className="font-semibold text-zinc-900 dark:text-zinc-50">{run.totalOrders}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Realized PnL</dt>
          <dd className={`font-semibold ${run.realizedPnl >= 0 ? "text-green-600" : "text-red-600"}`}>
            {formatCurrency(run.realizedPnl)}
          </dd>
        </div>
      </dl>

      {run.status === "running" && onStop && (
        <button
          onClick={() => onStop(run.id)}
          className="mt-4 w-full rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
        >
          Stop Strategy
        </button>
      )}
    </div>
  );
}
