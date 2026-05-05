/**
 * components/cards/SystemHealthCard.tsx
 *
 * Card showing per-service connection status with specific error messages.
 * Includes a live engine status row driven by the /ws/events WebSocket stream.
 * Used on the Dashboard page for at-a-glance system monitoring.
 *
 * Inputs:  SystemStatus object from the backend /api/system/status endpoint.
 * Outputs: Rendered health card with per-service indicators and error text.
 */

"use client";

import { useState, useEffect } from "react";
import type { SystemStatus, ServiceHealth } from "../../types/api";
import { formatIsoTimestamp } from "../../utils/dates";
import { useWebSocket } from "../../hooks/useWebSocket";

interface Props {
  readonly status: SystemStatus | null;
  readonly isLoading?: boolean;
}

const BANNER: Record<SystemStatus["status"], { label: string; classes: string }> = {
  healthy:   { label: "All systems operational",  classes: "bg-green-50  text-green-700  dark:bg-green-950  dark:text-green-300"  },
  degraded:  { label: "Some services degraded",   classes: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300" },
  unhealthy: { label: "System errors detected",   classes: "bg-red-50    text-red-700    dark:bg-red-950    dark:text-red-300"    },
};

function ServiceRow({ label, health }: { readonly label: string; readonly health: ServiceHealth }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${health.health ? "bg-green-500" : "bg-red-500"}`}
        />
        <span className="text-sm text-zinc-600 dark:text-zinc-400">{label}</span>
      </div>
      {!health.health && health.error && (
        <p className="ml-[18px] text-xs text-red-500 dark:text-red-400">{health.error}</p>
      )}
    </div>
  );
}

export default function SystemHealthCard({ status, isLoading }: Props) {
  const [engineRunning, setEngineRunning] = useState<boolean | null>(null);
  const { lastMessage } = useWebSocket<{ type: string }>("/ws/events");

  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === "ENGINE_STARTED") setEngineRunning(true);
    if (lastMessage.type === "ENGINE_STOPPED") setEngineRunning(false);
  }, [lastMessage]);

  if (isLoading || !status) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">System Health</h2>
        <p className="text-sm text-zinc-400">Loading…</p>
      </div>
    );
  }

  const banner = BANNER[status.status];

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">System Health</h2>

      <p className={`mb-4 rounded px-2.5 py-1 text-xs font-medium ${banner.classes}`}>
        {banner.label}
      </p>

      <div className="flex flex-col gap-3">
        <ServiceRow label="Backend"  health={status.services.backend}  />
        <ServiceRow label="Supabase" health={status.services.supabase} />
        <ServiceRow label="Alpaca"   health={status.services.alpaca}   />
        {engineRunning !== null && (
          <ServiceRow
            label="Engine"
            health={{ health: engineRunning, error: engineRunning ? undefined : "Engine stopped" }}
          />
        )}
      </div>

      <p className="mt-4 text-xs text-zinc-400">
        Mode: <span className="font-medium capitalize text-zinc-600 dark:text-zinc-300">{status.mode}</span>
        {" · "}
        Last updated: {formatIsoTimestamp(status.ts)}
      </p>
    </div>
  );
}
