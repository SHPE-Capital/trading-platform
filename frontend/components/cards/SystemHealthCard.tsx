/**
 * components/cards/SystemHealthCard.tsx
 *
 * Card showing engine connection status and health indicators.
 * Used on the Dashboard page for at-a-glance system monitoring.
 *
 * Inputs:  SystemStatus object from the backend /api/system/status endpoint.
 * Outputs: Rendered health card with connection indicators.
 */

import type { SystemStatus } from "../../types/api";
import { formatIsoTimestamp } from "../../utils/dates";

interface Props {
  status: SystemStatus | null;
  isLoading?: boolean;
}

function Indicator({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${active ? "bg-green-500" : "bg-zinc-300 dark:bg-zinc-600"}`} />
      <span className="text-sm text-zinc-600 dark:text-zinc-400">{label}</span>
    </div>
  );
}

export default function SystemHealthCard({ status, isLoading }: Props) {
  if (isLoading || !status) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">System Health</h2>
        <p className="text-sm text-zinc-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">System Health</h2>
      <div className="flex flex-col gap-2">
        <Indicator label="Engine running"       active={status.engineRunning} />
        <Indicator label="Alpaca connected"     active={status.connectedToAlpaca} />
      </div>
      <p className="mt-4 text-xs text-zinc-400">
        Mode: <span className="font-medium capitalize text-zinc-600 dark:text-zinc-300">{status.mode}</span>
        {" · "}
        Last updated: {formatIsoTimestamp(status.ts)}
      </p>
    </div>
  );
}
