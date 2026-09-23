/**
 * features/approvals/CapitalExposurePanel.tsx
 *
 * Shows a lead what approving adds to the book: the capital caps of every
 * strategy already live in this execution mode, summed, plus this proposal's.
 * Caps are ceilings (riskBudget.maxCapitalPct), not current usage — the
 * question is whether the club is about to promise out more of the book than
 * it has, which the per-order risk checks only discover one rejection at a time.
 */

"use client";

import type { CapitalExposure } from "../../types/review";

interface Props {
  exposure: CapitalExposure;
  /** The lead's sizing override (0–1), when one is typed in. Wins over the proposed cap. */
  overridePct: number | null;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export default function CapitalExposurePanel({ exposure, overridePct }: Readonly<Props>) {
  const thisPct = overridePct ?? exposure.proposedPct;
  const after = exposure.allocatedPct + (thisPct ?? 0);
  const overCommitted = after > 1;
  const dollars = (fraction: number) =>
    exposure.bookEquity != null
      ? ` · $${Math.round(exposure.bookEquity * fraction).toLocaleString()}`
      : "";

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Book allocation ({exposure.executionMode})
      </h3>

      <dl className="mt-3 flex flex-col gap-1 text-xs">
        <div className="flex justify-between">
          <dt className="text-zinc-500 dark:text-zinc-400">
            Live now ({exposure.liveRuns.length} run{exposure.liveRuns.length === 1 ? "" : "s"})
          </dt>
          <dd className="font-mono text-zinc-700 dark:text-zinc-300">{pct(exposure.allocatedPct)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-zinc-500 dark:text-zinc-400">This proposal</dt>
          <dd className="font-mono text-zinc-700 dark:text-zinc-300">{thisPct != null ? pct(thisPct) : "uncapped"}</dd>
        </div>
        <div className="mt-1 flex justify-between border-t border-zinc-100 pt-1 dark:border-zinc-800">
          <dt className="font-medium text-zinc-700 dark:text-zinc-300">After approval</dt>
          <dd
            data-testid="after-approval"
            className={`font-mono font-medium ${overCommitted ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-50"}`}
          >
            {pct(after)}{dollars(after)}
          </dd>
        </div>
      </dl>

      {overCommitted && (
        <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
          Caps would exceed the whole book. Strategies will start blocking each other on capital — consider sizing down.
        </p>
      )}
      {(exposure.uncappedRuns > 0 || thisPct == null) && (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          {exposure.uncappedRuns > 0 && `${exposure.uncappedRuns} live run(s) have no cap, `}
          {thisPct == null && "this proposal has no cap, "}
          so the total is a lower bound.
        </p>
      )}

      {exposure.liveRuns.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-zinc-100 pt-2 text-[11px] dark:border-zinc-800">
          {exposure.liveRuns.map((r) => (
            <li key={r.runId} className="flex justify-between gap-2">
              <span className="truncate text-zinc-600 dark:text-zinc-400">
                {r.name}
                {r.ownerName && <span className="text-zinc-400"> · {r.ownerName}</span>}
              </span>
              <span className="shrink-0 font-mono text-zinc-500">
                {r.maxCapitalPct != null ? pct(r.maxCapitalPct) : "uncapped"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
