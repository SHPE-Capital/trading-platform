/**
 * components/controls/StrategyControls.tsx
 *
 * Start/stop control buttons for a strategy run.
 * Used on the Strategy Management page to control active strategies.
 *
 * Inputs:  strategyId, current status, onStart/onStop callbacks.
 * Outputs: Rendered start/stop buttons with loading state.
 */

"use client";

import { useState } from "react";
import type { StrategyRunStatus } from "../../types/strategy";

interface Props {
  strategyId: string;
  status: StrategyRunStatus;
  onStop: (id: string) => Promise<void>;
}

export default function StrategyControls({ strategyId, status, onStop }: Props) {
  const [isPending, setIsPending] = useState(false);

  const handleStop = async () => {
    setIsPending(true);
    try {
      await onStop(strategyId);
    } finally {
      setIsPending(false);
    }
  };

  if (status !== "running") return null;

  return (
    <button
      onClick={handleStop}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
    >
      {isPending ? "Stopping…" : "Stop Strategy"}
    </button>
  );
}
