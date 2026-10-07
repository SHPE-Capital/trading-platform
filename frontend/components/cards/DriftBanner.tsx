/**
 * components/cards/DriftBanner.tsx
 *
 * Alerts when the broker holds positions no running run accounts for: shares
 * with no run behind them at all, or shares left behind by a stopped run.
 * Alert only — trading is not blocked.
 *
 * Inputs:  DriftRow[] from GET /broker/drift or the BROKER_DRIFT event.
 */

import type { DriftRow } from "../../types/analytics";

export default function DriftBanner({ rows }: { rows: DriftRow[] }) {
  if (rows.length === 0) return null;
  const unattributed = rows.filter((r) => r.unattributedQty !== 0);
  const stopped = rows.filter((r) => r.stoppedQty !== 0);
  return (
    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
      <p className="font-medium">Positions not managed by a running strategy</p>
      {stopped.length > 0 && (
        <p className="mt-1">
          Held by stopped runs: {stopped.map((r) => `${r.symbol} ${r.stoppedQty}`).join(", ")}.
          Open the run from Strategies to see which one, then flatten it or start a run to manage it.
        </p>
      )}
      {unattributed.length > 0 && (
        <p className="mt-1">
          No run accounts for: {unattributed.map((r) => `${r.symbol} ${r.unattributedQty}`).join(", ")} —
          an order placed outside the platform, or history the ledger has not synced.
        </p>
      )}
    </div>
  );
}
