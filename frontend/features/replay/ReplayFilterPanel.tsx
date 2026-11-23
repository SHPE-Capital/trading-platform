/**
 * features/replay/ReplayFilterPanel.tsx
 *
 * Narrows which events of a recorded session are loaded for replay: event
 * types, symbols, and a time window. All set fields must match; events with
 * no symbol (system, portfolio) pass a symbol filter, so every strategy that
 * touched those symbols still shows in the replayed stream.
 *
 * Inputs:  Selected event log ID; onApply callback that loads it filtered.
 * Outputs: Filter form; calls onApply(filter) on submit.
 */

"use client";

import { useState } from "react";
import type { ReplayFilter } from "../../types/api";

interface Props {
  /** Event log to load; the form is disabled until one is selected. */
  sessionId: string | null;
  onApply: (filter: ReplayFilter) => Promise<void>;
}

const EVENT_GROUPS: Array<{ label: string; types: string[] }> = [
  { label: "Market data", types: ["QUOTE_RECEIVED", "TRADE_RECEIVED", "BAR_RECEIVED"] },
  { label: "Strategy", types: ["STRATEGY_SIGNAL_CREATED", "STRATEGY_STARTED", "STRATEGY_STOPPED", "STRATEGY_ERROR"] },
  {
    label: "Orders",
    types: ["ORDER_INTENT_CREATED", "ORDER_SUBMITTED", "ORDER_FILLED", "ORDER_PARTIAL_FILL", "ORDER_CANCELED", "ORDER_REJECTED"],
  },
  { label: "Risk & capital", types: ["RISK_REJECTED", "CAPITAL_RESERVED", "CAPITAL_RELEASED", "CAPITAL_UNAVAILABLE"] },
  { label: "Portfolio", types: ["PORTFOLIO_UPDATED"] },
];

function label(type: string): string {
  return type.toLowerCase().replace(/_/g, " ");
}

export default function ReplayFilterPanel({ sessionId, onApply }: Props) {
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [symbols, setSymbols] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [applying, setApplying] = useState(false);

  const filter: ReplayFilter = {};
  if (types.size > 0) filter.eventTypes = [...types];
  const symbolList = symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (symbolList.length > 0) filter.symbols = symbolList;
  if (start) filter.startTs = new Date(start).getTime();
  if (end) filter.endTs = new Date(end).getTime();
  const isEmpty = Object.keys(filter).length === 0;
  const badWindow = filter.startTs !== undefined && filter.endTs !== undefined && filter.startTs > filter.endTs;

  const toggle = (type: string) => {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const clear = () => {
    setTypes(new Set());
    setSymbols("");
    setStart("");
    setEnd("");
  };

  const inputClass =
    "rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!sessionId || isEmpty || badWindow) return;
        setApplying(true);
        try {
          await onApply(filter);
        } finally {
          setApplying(false);
        }
      }}
    >
      <p className="text-xs font-medium text-zinc-500">Filter events</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {EVENT_GROUPS.map((group) => (
          <fieldset key={group.label} className="flex flex-col gap-1">
            <legend className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">{group.label}</legend>
            {group.types.map((type) => (
              <label key={type} className="flex items-center gap-1.5 text-xs text-zinc-500">
                <input type="checkbox" checked={types.has(type)} onChange={() => toggle(type)} />
                {label(type)}
              </label>
            ))}
          </fieldset>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Symbols
          <input
            type="text"
            placeholder="SPY, QQQ"
            value={symbols}
            onChange={(e) => setSymbols(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          From
          <input type="datetime-local" step={1} value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          To
          <input type="datetime-local" step={1} value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
        </label>
        <button
          type="submit"
          disabled={!sessionId || isEmpty || badWindow || applying}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {applying ? "Loading…" : "Apply filter"}
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={isEmpty}
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400"
        >
          Clear
        </button>
      </div>
      {badWindow && <p className="text-xs text-red-500">“From” must be before “To”.</p>}
    </form>
  );
}
