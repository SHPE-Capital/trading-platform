/**
 * components/cards/StrategyStatusCard.tsx
 *
 * Card showing the current status and key metrics for a single strategy run.
 * Used on the Dashboard and Strategy Management pages.
 *
 * Inputs:  StrategyRun object.
 * Outputs: Rendered status card with run state badge, signal/order counts, and PnL.
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { StrategyRun } from "../../types/strategy";
import { formatCurrency } from "../../utils/formatting";

/**
 * Wall-clock time that advances while mounted. Reading Date.now() during render
 * is impure; this also keeps a lease that lapses while the card is on screen
 * from reading as held forever.
 */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

interface Props {
  run: StrategyRun;
  onStop?: (id: string) => void;
}

const STATUS_BADGE: Record<string, string> = {
  idle:    "bg-zinc-100 text-zinc-600",
  running: "bg-green-100 text-green-700",
  "running elsewhere": "bg-green-50 text-green-700",
  paused:  "bg-yellow-100 text-yellow-700",
  stopped: "bg-zinc-100 text-zinc-500",
  error:   "bg-red-100 text-red-700",
  "awaiting runner": "bg-yellow-100 text-yellow-700",
};

export default function StrategyStatusCard({ run, onStop }: Props) {
  const now = useNow(15_000);
  // "running" in the DB but not registered in the process that served this
  // list: either another runner holds its lease (live, just not here), or no
  // runner does — a restart or crash, and a runner adopts it within a heartbeat.
  const notHere = run.status === "running" && run.isLive === false;
  const leasedElsewhere = notHere && !!run.leaseOwner && (run.leaseExpiresAt ?? 0) > now;
  const awaitingRunner = notHere && !leasedElsewhere;
  const displayStatus = leasedElsewhere ? "running elsewhere" : awaitingRunner ? "awaiting runner" : run.status;
  const badgeClass = STATUS_BADGE[displayStatus] ?? STATUS_BADGE["idle"];
  const errorStreak = run.status === "running" ? run.consecutiveErrors ?? 0 : 0;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between">
        <div>
          <Link href={`/runs/${run.id}`} className="text-sm font-semibold text-zinc-900 hover:underline dark:text-zinc-50">
            {(run.meta?.displayName as string | undefined) ?? run.name}
          </Link>
          <div className="flex items-center gap-1.5">
            <p className="text-xs text-zinc-400">{run.strategyType}</p>
            {run.strategyVersion != null && (
              <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                v{run.strategyVersion}
              </span>
            )}
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${badgeClass}`}>
          {displayStatus}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-4 gap-3 text-xs">
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
        <div>
          <dt className="text-zinc-500">Open PnL</dt>
          <dd className={`font-semibold ${(run.unrealizedPnl ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
            {formatCurrency(run.unrealizedPnl ?? 0)}
          </dd>
        </div>
      </dl>

      {run.status === "error" && run.disabledReason && (
        <p className="mt-3 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-400">
          {run.disabledReason}
        </p>
      )}
      {errorStreak > 0 && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          {errorStreak} evaluation error{errorStreak === 1 ? "" : "s"} in a row — the runner disables it if this continues.
        </p>
      )}
      {run.status !== "running" && (run.stats?.openPositions.length ?? 0) > 0 && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          Stopped, but still holds {run.stats!.openPositions.map((p) => `${p.symbol} ${p.qty}`).join(", ")} — nothing is managing these.
        </p>
      )}
      {awaitingRunner && (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          No runner holds this run right now. A running trading process adopts it within about 30 seconds.
        </p>
      )}

      {(run.isLive || leasedElsewhere) && onStop && (
        <button
          onClick={() => onStop(run.id)}
          className="mt-4 w-full rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
        >
          Stop Strategy
        </button>
      )}

      {awaitingRunner && onStop && (
        <button
          onClick={() => onStop(run.id)}
          className="mt-4 w-full rounded-md border border-yellow-200 px-3 py-1.5 text-xs font-medium text-yellow-700 transition-colors hover:bg-yellow-50"
        >
          Stop instead of resuming
        </button>
      )}
    </div>
  );
}
