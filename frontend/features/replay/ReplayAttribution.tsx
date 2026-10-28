/**
 * features/replay/ReplayAttribution.tsx
 *
 * Attribution report of a completed replay: summary metrics, a per-strategy
 * breakdown, a sortable signal table and the equity curve. Built from the
 * recorded signals and fills — the replay does not re-run strategies.
 *
 * Inputs:  ReplayAttribution from GET /replay/attribution.
 * Outputs: Rendered report.
 */

"use client";

import { useMemo, useState } from "react";
import PnLChart from "../../components/charts/PnLChart";
import { formatCurrency, formatPercent, formatNumber, pnlColorClass } from "../../utils/formatting";
import { formatDuration, formatTimestamp } from "../../utils/dates";
import type { ReplayAttribution as Attribution, SignalAttribution, SignalOutcome } from "../../types/api";

interface Props {
  attribution: Attribution;
}

type SortKey = "symbol" | "direction" | "signalTs" | "signalMidPrice" | "fillPrice" | "slippageBps" | "holdingTimeMs" | "realizedPnl" | "outcome";

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "symbol", label: "Symbol" },
  { key: "direction", label: "Direction" },
  { key: "signalTs", label: "Signal time" },
  { key: "signalMidPrice", label: "Mid" },
  { key: "fillPrice", label: "Fill" },
  { key: "slippageBps", label: "Slippage (bps)" },
  { key: "holdingTimeMs", label: "Held" },
  { key: "realizedPnl", label: "P&L" },
  { key: "outcome", label: "Outcome" },
];

const OUTCOME_CLASS: Record<SignalOutcome, string> = {
  filled: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  risk_rejected: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  capital_unavailable: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  no_fill: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

function compare(a: SignalAttribution, b: SignalAttribution, key: SortKey): number {
  const x = a[key];
  const y = b[key];
  // Nulls sort last either way.
  if (x === null) return y === null ? 0 : 1;
  if (y === null) return -1;
  if (typeof x === "number" && typeof y === "number") return x - y;
  return String(x).localeCompare(String(y));
}

function Stat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-sm font-semibold text-zinc-900 dark:text-zinc-50 ${className}`}>{value}</span>
    </div>
  );
}

export default function ReplayAttribution({ attribution: a }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "signalTs", desc: false });

  const signals = useMemo(() => {
    const sorted = [...a.signals].sort((x, y) => compare(x, y, sort.key));
    return sort.desc ? sorted.reverse() : sorted;
  }, [a.signals, sort]);

  const strategies = Object.entries(a.byStrategy);

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Attribution</h2>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 sm:grid-cols-3 lg:grid-cols-6 dark:border-zinc-800">
        <Stat label="Fill rate" value={`${formatPercent(a.fillRate, 1)} (${a.filledSignals}/${a.totalSignals})`} />
        <Stat label="Win rate" value={formatPercent(a.winRate, 1)} />
        <Stat label="Realized P&L" value={formatCurrency(a.totalRealizedPnl)} className={pnlColorClass(a.totalRealizedPnl)} />
        <Stat label="Avg slippage" value={`${formatNumber(a.avgSlippageBps, 2)} bps`} />
        <Stat label="Avg holding" value={a.avgHoldingTimeMs > 0 ? formatDuration(Math.round(a.avgHoldingTimeMs)) : "—"} />
        <Stat label="Max drawdown" value={formatPercent(a.maxDrawdown, 2)} />
      </div>

      {strategies.length > 1 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1.5 pr-4 font-medium">Strategy</th>
                <th className="py-1.5 pr-4 font-medium">Signals</th>
                <th className="py-1.5 pr-4 font-medium">Filled</th>
                <th className="py-1.5 pr-4 font-medium">Win rate</th>
                <th className="py-1.5 pr-4 font-medium">Realized P&L</th>
              </tr>
            </thead>
            <tbody className="text-zinc-700 dark:text-zinc-300">
              {strategies.map(([id, s]) => (
                <tr key={id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 pr-4 font-mono">{id}</td>
                  <td className="py-1.5 pr-4">{s.totalSignals}</td>
                  <td className="py-1.5 pr-4">{s.filledSignals}</td>
                  <td className="py-1.5 pr-4">{formatPercent(s.winRate, 1)}</td>
                  <td className={`py-1.5 pr-4 ${pnlColorClass(s.totalRealizedPnl)}`}>{formatCurrency(s.totalRealizedPnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {a.signals.length === 0 ? (
        <p className="text-xs text-zinc-400">No strategy signals in the replayed events.</p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white text-zinc-500 dark:bg-zinc-950">
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="py-1.5 pr-4 font-medium">
                    <button
                      type="button"
                      onClick={() => setSort((prev) => ({ key: c.key, desc: prev.key === c.key ? !prev.desc : false }))}
                      className="hover:text-zinc-900 dark:hover:text-zinc-50"
                    >
                      {c.label}{sort.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-zinc-700 dark:text-zinc-300">
              {signals.map((s) => (
                <tr key={s.signalId} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 pr-4 font-medium">{s.symbol}</td>
                  <td className="py-1.5 pr-4">{s.direction}</td>
                  <td className="py-1.5 pr-4">{formatTimestamp(s.signalTs)}</td>
                  <td className="py-1.5 pr-4">{s.signalMidPrice === null ? "—" : formatNumber(s.signalMidPrice, 2)}</td>
                  <td className="py-1.5 pr-4">{s.fillPrice === null ? "—" : formatNumber(s.fillPrice, 2)}</td>
                  <td className="py-1.5 pr-4">{s.slippageBps === null ? "—" : formatNumber(s.slippageBps, 2)}</td>
                  <td className="py-1.5 pr-4">{s.holdingTimeMs === null ? "—" : formatDuration(s.holdingTimeMs)}</td>
                  <td className={`py-1.5 pr-4 ${s.realizedPnl === null ? "" : pnlColorClass(s.realizedPnl)}`}>
                    {s.realizedPnl === null ? "—" : formatCurrency(s.realizedPnl)}
                  </td>
                  <td className="py-1.5 pr-4">
                    <span className={`rounded px-1.5 py-0.5 ${OUTCOME_CLASS[s.outcome]}`}>{s.outcome.replace(/_/g, " ")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PnLChart data={a.equityCurve} />
    </section>
  );
}
